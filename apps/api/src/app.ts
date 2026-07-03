import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { GitPort, CommitInput, CommitFilesInput } from '@setu/core'

export { createFormsApi } from './forms'

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort and the listener (server.ts). */
export function createGitApi(git: GitPort): Hono {
  const app = new Hono()
  app.use('*', cors())

  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '')
      return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  // Explicit type argument (json<T>) instead of `as T`: Hono's json() is generic with
  // an `any` default, so an `as` cast contextually types the call and reads as a
  // self-cast to no-unnecessary-type-assertion (--fix stripped it and orphaned the
  // imports). Same declared trust as before — this internal RPC API's input validation
  // story belongs to the auth epic (#248), not the linter increment.
  app.post('/git/commit', async (c) => {
    const body = await c.req.json<CommitInput>()
    const { sha } = await git.commitFile(body)
    return c.json({ sha })
  })

  app.post('/git/commit-files', async (c) => {
    const body = await c.req.json<CommitFilesInput>()
    const { sha } = await git.commitFiles(body)
    return c.json({ sha })
  })

  app.get('/git/list', async (c) => {
    const prefix = c.req.query('prefix')
    return c.json({ paths: await git.list(prefix) })
  })

  app.onError((err, c) =>
    c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  )
  return app
}
