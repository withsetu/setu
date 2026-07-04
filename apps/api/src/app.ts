import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Action, Actor, GitPort, CommitInput, CommitFilesInput } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

export { createFormsApi } from './forms'

const authz = createAuthz(DEFAULT_ROLES)

/** Capability gate: 403 when the (already-authenticated) actor lacks `action`. Pairs with
 *  `authMiddleware` (which sets the actor / 401s), mirroring media.ts's inline `authz.can` check. */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action)) return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort, the actor resolver, and the listener (server.ts).
 *
 *  Authz (#362, OWASP A01): /git/* is the repository write API — an ungated `POST /git/commit`
 *  let an anonymous caller rewrite any file in the content repo. The WRITE routes now require
 *  `content.edit` (held by Author/Editor/Maintainer/Admin; NOT Viewer) via the same `authMiddleware`
 *  + `authz.can` pattern as media.ts. The gate is coarse by design: /git/commit is a shared
 *  low-level primitive (posts, taxonomy, settings all funnel through it), so it can't distinguish a
 *  post-edit from a settings-write. That only over-trusts already-authenticated content staff (per
 *  epic #359); path-scoped git permissions are a later/Pro increment. The security-critical property
 *  closed here is that an unauthenticated or Viewer actor cannot write to the repo. The admin's
 *  HttpGitPort carries the session cookie (credentials: 'include' via apiFetch —
 *  apps/admin/src/data/Bootstrap.tsx).
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
  const canWrite = requireCan('content.edit')

  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  app.post('/git/commit', auth, canWrite, async (c) => {
    const body = (await c.req.json()) as CommitInput
    const { sha } = await git.commitFile(body)
    return c.json({ sha })
  })

  app.post('/git/commit-files', auth, canWrite, async (c) => {
    const body = (await c.req.json()) as CommitFilesInput
    const { sha } = await git.commitFiles(body)
    return c.json({ sha })
  })

  app.get('/git/list', async (c) => {
    const prefix = c.req.query('prefix')
    return c.json({ paths: await git.list(prefix) })
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
