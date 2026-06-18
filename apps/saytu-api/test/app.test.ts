import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '@setu/git-local'
import { createGitApi } from '../src/app'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

async function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'saytu-api-'))
  dirs.push(dir)
  await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
  return createGitApi(createLocalGitAdapter({ dir }))
}

const req = (app: ReturnType<typeof createGitApi>, path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://test${path}`, init))

const author = { name: 'Ed', email: 'ed@example.com' }

describe('createGitApi', () => {
  it('GET /git/head returns null sha on an empty repo', async () => {
    const app = await freshApp()
    const res = await req(app, '/git/head')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sha: null })
  })

  it('POST /git/commit returns a sha; GET /git/file reads it back', async () => {
    const app = await freshApp()
    const commit = await req(app, '/git/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'content/post/en/x.mdoc', content: '# Hi\n', message: 'add', author }),
    })
    expect(commit.status).toBe(200)
    const { sha } = (await commit.json()) as { sha: string }
    expect(typeof sha).toBe('string')

    expect(await (await req(app, '/git/head')).json()).toEqual({ sha })
    expect(await (await req(app, '/git/file?path=content/post/en/x.mdoc')).json()).toEqual({ content: '# Hi\n' })
    expect(await (await req(app, '/git/file?path=content/none.mdoc')).json()).toEqual({ content: null })
  })

  it('GET /git/list filters by prefix', async () => {
    const app = await freshApp()
    const mk = (path: string) =>
      req(app, '/git/commit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content: 'x', message: 'm', author }) })
    await mk('content/post/en/a.mdoc')
    await mk('saytu.config.ts')
    const { paths } = (await (await req(app, '/git/list?prefix=content/')).json()) as { paths: string[] }
    expect(paths).toEqual(['content/post/en/a.mdoc'])
  })

  it('GET /git/file without a path returns 400', async () => {
    const app = await freshApp()
    const res = await req(app, '/git/file')
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('error')
  })
})
