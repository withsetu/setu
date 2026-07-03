import { Hono } from 'hono'
import type { GitPort, CommitInput, CommitFilesInput } from '@setu/core'

export { createFormsApi } from './forms'

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort and the listener (server.ts).
 *  CORS/origin policy is owned centrally by server.ts (the allowlisted `cors()` +
 *  `originGuard`), not per-factory — a factory-local permissive `cors()` here would
 *  be clobbered onto the response after server.ts's allowlist runs, silently
 *  reopening every route to `*` origins. Tests exercise this app standalone
 *  (same-origin `.fetch()`), so no CORS headers are needed for those to pass. */
export function createGitApi(git: GitPort): Hono {
  const app = new Hono()

  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  app.post('/git/commit', async (c) => {
    const body = (await c.req.json()) as CommitInput
    const { sha } = await git.commitFile(body)
    return c.json({ sha })
  })

  app.post('/git/commit-files', async (c) => {
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
