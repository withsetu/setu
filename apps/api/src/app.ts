import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Action, Actor, GitPort, CommitInput, CommitFilesInput } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

export { createFormsApi } from './forms'

const authz = createAuthz(DEFAULT_ROLES)

/** Repo paths only an admin may write. Settings persist as `settings.json` at the repo root through
 *  this shared git primitive (there is NO dedicated settings route), so the write gate must
 *  distinguish a settings write from ordinary content BY PATH — otherwise any `content.edit` holder
 *  (author/editor/maintainer) could rewrite settings.json, bypassing the admin-only `settings.manage`
 *  (found in UAT 2026-07-05). This is the concrete first slice of the path-scoped git permissions the
 *  factory comment below anticipates. */
const ADMIN_ONLY_WRITE: Record<string, Action> = { 'settings.json': 'settings.manage' }

/** Normalize a repo-relative path for gate matching: drop a leading `./` or `/` so `./settings.json`
 *  and `/settings.json` can't slip past the exact-match check. (Deeper `../` traversal is the git
 *  port's concern, not the gate's.) */
const normalizeRepoPath = (p: string) => p.replace(/^\.?\/+/, '').trim()

/** The write permission a commit requires, derived from the paths it touches. Fail-closed: a commit
 *  touching ANY admin-only path requires that stronger permission (a maintainer cannot smuggle a
 *  settings change into a mixed commit); everything else needs `content.edit`. */
function writeActionForPaths(paths: string[]): Action {
  for (const p of paths) {
    const adminAction = ADMIN_ONLY_WRITE[normalizeRepoPath(p)]
    if (adminAction) return adminAction
  }
  return 'content.edit'
}

/** Authz gate for the write routes: parses the commit body, derives the required action from the
 *  target paths, and 403s an actor who lacks it. Pairs with `authMiddleware` (sets the actor / 401s).
 *  Hono caches `c.req.json()`, so the handler re-reading the same body is free. */
function requireWrite(pathsOf: (body: unknown) => string[]) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    let paths: string[]
    try {
      paths = pathsOf(await c.req.json())
    } catch {
      return c.json({ error: 'invalid request body' }, 400)
    }
    if (!authz.can(c.get('actor'), writeActionForPaths(paths))) return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort, the actor resolver, and the listener (server.ts).
 *
 *  Authz (#362, OWASP A01): /git/* is the repository write API — an ungated `POST /git/commit`
 *  let an anonymous caller rewrite any file in the content repo. The WRITE routes require a write
 *  permission derived from the TARGET PATHS (`writeActionForPaths`): ordinary content needs
 *  `content.edit` (Author/Editor/Maintainer/Admin), while `settings.json` needs the admin-only
 *  `settings.manage` — settings share this primitive and must NOT be writable by content staff
 *  (UAT 2026-07-05). Path scoping is otherwise still coarse (a later/Pro increment refines it beyond
 *  settings). The security-critical properties are that an unauthenticated actor cannot write at all,
 *  and content staff cannot write admin-only files. The admin's HttpGitPort carries the session
 *  cookie (credentials: 'include' via apiFetch — apps/admin/src/data/Bootstrap.tsx).
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
  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(resolveActor)

  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  app.post(
    '/git/commit',
    auth,
    requireWrite((b) => {
      const p = (b as CommitInput).path
      return typeof p === 'string' ? [p] : []
    }),
    async (c) => {
      const body = (await c.req.json()) as CommitInput
      const { sha } = await git.commitFile(body)
      return c.json({ sha })
    },
  )

  app.post(
    '/git/commit-files',
    auth,
    requireWrite((b) => {
      const changes = (b as CommitFilesInput).changes
      return Array.isArray(changes) ? changes.map((ch) => ch.path).filter((p): p is string => typeof p === 'string') : []
    }),
    async (c) => {
      const body = (await c.req.json()) as CommitFilesInput
      const { sha } = await git.commitFiles(body)
      return c.json({ sha })
    },
  )

  app.get('/git/list', async (c) => {
    const prefix = c.req.query('prefix')
    return c.json({ paths: await git.list(prefix) })
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
