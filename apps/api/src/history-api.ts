import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Action, GitPort } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import { writeActionForChanges } from './app'
import type { ResolveActor, ResolvedActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

/** Max bytes for a restore body — `{path, sha, author?}` is tiny; this is a DoS
 *  ceiling on the unbounded `c.req.json()` (the git-write-route posture). */
const RESTORE_MAX_BYTES = 16 * 1024

/** Capability gate: 403 when the (already-authenticated) actor lacks `action`.
 *  Pairs with `authMiddleware` — the forms.ts/index-api.ts pattern. */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: ResolvedActor } }>(
    async (c, next) => {
      if (!authz.can(c.get('actor'), action))
        return c.json({ error: 'forbidden' }, 403)
      await next()
    }
  )
}

/** The honest-degradation body for adapters without the optional history
 *  capability (git-http/git-idb today) — 409, the media-reprocess precedent. */
const HISTORY_UNAVAILABLE = { error: 'history unavailable in this mode' }

// Boundary schemas (docs/security-standards.md: new input → Zod).
// Paths are constrained to the content tree — history is a CONTENT feature;
// exposing the revision log of settings.json/theme-options.json through a
// `content.view` route would leak admin-gated material to every staff role.
// `..` is rejected outright so no traversal ever reaches the adapter.
const contentPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^content\//)
  .refine((p) => !p.includes('..'))

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/)

// Out-of-range limits are REJECTED (400), not clamped — the index-api
// precedent: a caller sending limit=1000 has a bug worth surfacing.
const listQuerySchema = z.object({
  path: contentPathSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
})

const fileQuerySchema = z.object({ sha: shaSchema, path: contentPathSchema })

const restoreSchema = z.object({
  path: contentPathSchema,
  sha: shaSchema,
  /** Fallback identity for the local/no-session topology only — a session's
   *  `gitAuthor` is always stamped over it (#382). */
  author: z
    .object({ name: z.string().min(1), email: z.string().min(1) })
    .optional()
})

/** A Hono app exposing revision history from Git (#466): list a content path's
 *  revisions, read the content at a revision, and restore one. Pure factory —
 *  the caller supplies the GitPort and actor resolver (server.ts).
 *
 *  Authz: list/file are content READS → `authMiddleware` + `content.view`
 *  (every staff role; unauth → 401). Restore is a content WRITE and derives its
 *  required permission through the SAME `writeActionForChanges` seam as
 *  /git/commit — an author cannot restore a live post into a different state
 *  (committed-live → `content.publish`) any more than they could commit it
 *  directly (failure mode #13). Fail-closed throughout.
 *
 *  Capability posture (card #6): `log`/`readFileAt` are OPTIONAL GitPort
 *  members; adapters without them (git-http/git-idb today) → 409 with a clear
 *  body, and /api/capabilities reports `history: false` so the admin never
 *  shows the UI. Checked per-route AFTER auth so capability facts are not
 *  advertised to unauthenticated probes.
 *
 *  CORS/origin policy is owned centrally by server.ts (see createGitApi's
 *  comment) — this factory sets none of its own. */
export function createHistoryApi(git: GitPort, resolveActor: ResolveActor) {
  const app = new Hono<{ Variables: { actor: ResolvedActor } }>()
  const auth = authMiddleware(resolveActor)
  const canView = requireCan('content.view')

  app.get('/api/history', auth, canView, async (c) => {
    const log = git.log?.bind(git)
    if (!log) return c.json(HISTORY_UNAVAILABLE, 409)
    const parsed = listQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    const { path, limit, offset } = parsed.data
    return c.json({ entries: await log(path, { limit, offset }) })
  })

  app.get('/api/history/file', auth, canView, async (c) => {
    const readFileAt = git.readFileAt?.bind(git)
    if (!readFileAt) return c.json(HISTORY_UNAVAILABLE, 409)
    const parsed = fileQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    const { sha, path } = parsed.data
    let content: string | null
    try {
      content = await readFileAt(sha, path)
    } catch {
      // The adapter REJECTS on a sha it cannot resolve (diffPaths parity).
      // Route-level, "that revision of that file" simply doesn't exist → 404,
      // same as a path absent at a known commit.
      content = null
    }
    if (content === null) return c.json({ error: 'not found' }, 404)
    return c.json({ content })
  })

  const restoreBodyLimit = bodyLimit({
    maxSize: RESTORE_MAX_BYTES,
    onError: (c) => c.json({ error: 'payload too large' }, 413)
  })

  app.post('/api/history/restore', restoreBodyLimit, auth, async (c) => {
    const readFileAt = git.readFileAt?.bind(git)
    if (!readFileAt) return c.json(HISTORY_UNAVAILABLE, 409)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid' }, 400)
    }
    const parsed = restoreSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    const { path, sha } = parsed.data

    let content: string | null
    try {
      content = await readFileAt(sha, path)
    } catch {
      content = null // unknown sha → 404 (see /api/history/file)
    }
    // 404 before the write gate: revision existence is `content.view`-grade
    // information (every staff role holding a session here already has it).
    if (content === null) return c.json({ error: 'not found' }, 404)

    // THE same write-permission derivation as /git/commit (#466): the restored
    // content going live, or the committed target being live, demands
    // `content.publish`; a draft-to-draft restore only `content.edit`.
    if (
      !authz.can(
        c.get('actor'),
        await writeActionForChanges([{ path, content }], git)
      )
    )
      return c.json({ error: 'forbidden' }, 403)

    // Server-authoritative identity (#382): the session's git author is stamped
    // over whatever the body claims; the body author is only the local/no-auth
    // fallback. Neither present → refuse rather than invent an identity.
    const author = c.get('actor').gitAuthor ?? parsed.data.author
    if (!author) return c.json({ error: 'author required' }, 400)

    const { sha: newSha } = await git.commitFile({
      path,
      content,
      message: `Restore ${path} to ${sha.slice(0, 7)}`,
      author
    })
    return c.json({ sha: newSha })
  })

  app.onError(apiOnError({ scope: 'history' })) // #291: prod-generic, never err.message
  return app
}
