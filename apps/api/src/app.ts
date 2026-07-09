import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import {
  createAuthz,
  DEFAULT_ROLES,
  parseContentPath,
  parseMdoc
} from '@setu/core'
import type { Action, GitPort, CommitInput, CommitFilesInput } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor, ResolvedActor } from './auth/resolve-actor'

export { createFormsApi } from './forms'

const authz = createAuthz(DEFAULT_ROLES)

/** Repo paths only an admin may write. Settings persist as `settings.json` at the repo root through
 *  this shared git primitive (there is NO dedicated settings route), so the write gate must
 *  distinguish a settings write from ordinary content BY PATH — otherwise any `content.edit` holder
 *  (author/editor/maintainer) could rewrite settings.json, bypassing the admin-only `settings.manage`
 *  (found in UAT 2026-07-05). This is the concrete first slice of the path-scoped git permissions the
 *  factory comment below anticipates. */
const ADMIN_ONLY_WRITE: Record<string, Action> = {
  'settings.json': 'settings.manage'
}

/** Normalize a repo-relative path for gate matching: drop a leading `./` or `/` so `./settings.json`
 *  and `/settings.json` can't slip past the exact-match check. (Deeper `../` traversal is the git
 *  port's concern, not the gate's.) */
const normalizeRepoPath = (p: string) => p.replace(/^\.?\/+/, '').trim()

/** One change in a commit, as the gate sees it: a path plus (for writes) the content being written.
 *  `content` is undefined for a deletion. */
interface WriteChange {
  path: string
  content?: string
}

/** True if committing `content` to a content post PUBLISHES it live. Setu's rule (publish-semantics):
 *  an entry is live when committed and NOT `published: false`. So a missing/true `published` = live
 *  (requires `content.publish`); `published: false` = a draft (only `content.edit`). Fail-closed:
 *  unparseable content we can't prove is a draft is treated as a publish (the stronger permission). */
function publishesLiveContent(content: string): boolean {
  try {
    return parseMdoc(content).frontmatter['published'] !== false
  } catch {
    return true
  }
}

/** The write permission a commit requires, derived from the paths, the content being written, AND
 *  the COMMITTED state of each touched file. Fail-closed: a commit requires the STRONGEST
 *  permission any of its changes needs, so nothing can be smuggled in with a lower-privilege
 *  change.
 *   - `settings.json`                       → `settings.manage` (admin only)
 *   - new content that IS live               → `content.publish` (publishing is gated server-side,
 *                                              not just in the UI's PublishMenu — an author must
 *                                              not publish via the raw API)
 *   - touching a file whose COMMITTED
 *     content is live (live-edit, unpublish,
 *     or delete of a live post)              → `content.publish` (#382: an author must not be able
 *                                              to silently unpublish or delete a live post just
 *                                              because content.edit lets them write drafts)
 *   - everything else (drafts, taxonomy)     → `content.edit`
 *  Only content paths need the committed-state read (`git.readFile`), and no read happens at all
 *  once `content.publish` is required — the strongest content action is settled, so the remaining
 *  iterations only scan for the admin-only settings path. */
async function writeActionForChanges(
  changes: WriteChange[],
  git: GitPort
): Promise<Action> {
  let action: Action = 'content.edit'
  for (const { path, content } of changes) {
    const p = normalizeRepoPath(path)
    const adminAction = ADMIN_ONLY_WRITE[p]
    if (adminAction) return adminAction // settings.manage — the strongest; short-circuit.
    if (!parseContentPath(p)) continue // taxonomy etc. — content.edit is enough
    if (action === 'content.publish') continue // already required — no read can raise it further
    if (content !== undefined && publishesLiveContent(content)) {
      action = 'content.publish'
      continue // already the strongest content action — skip the committed-state read
    }
    const committed = await git.readFile(p)
    if (committed !== null && publishesLiveContent(committed)) {
      action = 'content.publish' // live-edit, unpublish, or delete of an already-live post
    }
  }
  return action
}

/** Authz gate for the write routes: parses the commit body, derives the required action from the
 *  target paths + new content + committed state, and 403s an actor who lacks it. Pairs with
 *  `authMiddleware` (sets the actor / 401s). Hono caches `c.req.json()`, so the handler re-reading
 *  the same body is free. */
function requireWrite(
  git: GitPort,
  changesOf: (body: unknown) => WriteChange[]
) {
  return createMiddleware<{ Variables: { actor: ResolvedActor } }>(
    async (c, next) => {
      let changes: WriteChange[]
      try {
        changes = changesOf(await c.req.json())
      } catch {
        return c.json({ error: 'invalid request body' }, 400)
      }
      if (!authz.can(c.get('actor'), await writeActionForChanges(changes, git)))
        return c.json({ error: 'forbidden' }, 403)
      await next()
    }
  )
}

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort, the actor resolver, and the listener (server.ts).
 *
 *  Authz (#362, OWASP A01): /git/* is the repository write API — an ungated `POST /git/commit`
 *  let an anonymous caller rewrite any file in the content repo. The WRITE routes require a write
 *  permission derived from the target paths, the NEW content, AND the COMMITTED state of each
 *  touched path (`writeActionForChanges`):
 *    - `settings.json`           → `settings.manage` (admin only — settings share this primitive and
 *                                  must not be writable by content staff; UAT 2026-07-05).
 *    - a content post going live → `content.publish` — publishing is enforced HERE, server-side, not
 *                                  only in the UI's PublishMenu, so an author (who lacks
 *                                  `content.publish`) cannot publish by POSTing live content directly.
 *                                  A `published: false` draft only needs `content.edit`.
 *    - a change touching a path whose COMMITTED content is already live → `content.publish` (#382:
 *                                  writing `published: false` over a live post, deleting a live
 *                                  post, or any other edit to it is a publish-adjacent action — an
 *                                  author must not be able to silently unpublish or delete a live
 *                                  post just because `content.edit` lets them write drafts).
 *    - everything else            → `content.edit` (Author/Editor/Maintainer/Admin).
 *  Fail-closed: a mixed commit requires the strongest permission any change needs. Path scoping is
 *  otherwise still coarse (taxonomy also rides `content.edit`; a later/Pro increment refines it). The
 *  security-critical properties: an unauthenticated actor cannot write at all, content staff cannot
 *  write admin-only files, non-publishers cannot publish, and non-publishers cannot alter a post that
 *  is already live. The admin's HttpGitPort carries the session cookie (credentials: 'include' via
 *  apiFetch — apps/admin/src/data/Bootstrap.tsx).
 *
 *  The READ routes (head/file/list) are intentionally NOT gated: the admin's `bootstrapServices`
 *  reads `git.headSha()` at startup, BEFORE the user has a session (to decide seed-if-empty), so
 *  gating reads 401s that bootstrap read and hangs the whole admin on "Loading…" (caught in live
 *  UAT). #362 scopes the git hole to WRITES; making reads auth-aware needs bootstrap to defer its git
 *  read until after the session resolves — tracked with the actor-auth work in #110, not here.
 *
 *  CORS/origin policy is owned centrally by server.ts (the allowlisted `cors()` +
 *  `originGuard`), not per-factory — a factory-local permissive `cors()` here would
 *  be clobbered onto the response after server.ts's allowlist runs, silently
 *  reopening every route to `*` origins. Tests exercise this app standalone
 *  (same-origin `.fetch()`), so no CORS headers are needed for those to pass. */
export function createGitApi(git: GitPort, resolveActor: ResolveActor) {
  const app = new Hono<{ Variables: { actor: ResolvedActor } }>()
  const auth = authMiddleware(resolveActor)

  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '')
      return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  app.post(
    '/git/commit',
    auth,
    requireWrite(git, (b) => {
      const { path, content } = b as CommitInput
      return typeof path === 'string' ? [{ path, content }] : []
    }),
    async (c) => {
      const body = await c.req.json<CommitInput>()
      // Server-authoritative identity: the session's git author (when known) is stamped over
      // whatever the client's request body claims — never trust the client for who committed
      // (#382). No session identity (e.g. local/no-auth dev) → the body's author is the fallback.
      const author = c.get('actor').gitAuthor ?? body.author
      const { sha } = await git.commitFile({ ...body, author })
      return c.json({ sha })
    }
  )

  app.post(
    '/git/commit-files',
    auth,
    requireWrite(git, (b) => {
      const changes = (b as CommitFilesInput).changes
      if (!Array.isArray(changes)) return []
      return changes
        .filter(
          (ch): ch is CommitFilesInput['changes'][number] =>
            typeof ch?.path === 'string'
        )
        .map((ch) => ({
          path: ch.path,
          content: 'content' in ch ? ch.content : undefined
        }))
    }),
    async (c) => {
      const body = await c.req.json<CommitFilesInput>()
      // Server-authoritative identity — see the /git/commit route above (#382).
      const author = c.get('actor').gitAuthor ?? body.author
      const { sha } = await git.commitFiles({ ...body, author })
      return c.json({ sha })
    }
  )

  app.get('/git/list', async (c) => {
    const prefix = c.req.query('prefix')
    return c.json({ paths: await git.list(prefix) })
  })

  app.onError((err, c) =>
    c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  )
  return app
}
