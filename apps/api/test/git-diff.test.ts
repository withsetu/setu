import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DiffPathEntry } from '@setu/core'

const author = { name: 'T', email: 't@x.com' }

function makeApp() {
  const git = createMemoryGitPort()
  const app = createGitApi(git, () => ({ id: 'local', role: 'admin' }))
  return { git, app }
}

describe('GET /git/diff', () => {
  it('returns the changed paths between two commits', async () => {
    const { git, app } = makeApp()
    const { sha: from } = await git.commitFile({
      path: 'content/post/en/a.mdoc',
      content: 'v1',
      message: 'm1',
      author
    })
    const { sha: to } = await git.commitFiles({
      changes: [
        { path: 'content/post/en/a.mdoc', content: 'v2' },
        { path: 'content/post/en/b.mdoc', content: 'B' }
      ],
      message: 'm2',
      author
    })
    const res = await app.fetch(
      new Request(`http://x/git/diff?from=${from}&to=${to}`)
    )
    expect(res.status).toBe(200)
    const { changes } = (await res.json()) as { changes: DiffPathEntry[] }
    expect([...changes].sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual([
      { path: 'content/post/en/a.mdoc', status: 'modified' },
      { path: 'content/post/en/b.mdoc', status: 'added' }
    ])
  })

  it('400s when a query param is missing', async () => {
    const { app } = makeApp()
    const res = await app.fetch(
      new Request(`http://x/git/diff?from=${'a'.repeat(40)}`)
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'from and to must be 40-hex commit shas'
    })
  })

  it('400s on garbage (non-40-hex) params without touching the adapter', async () => {
    const git = createMemoryGitPort()
    let called = false
    const app = createGitApi(
      {
        ...git,
        diffPaths(fromSha: string, toSha: string) {
          called = true
          return git.diffPaths(fromSha, toSha)
        }
      },
      () => ({ id: 'local', role: 'admin' })
    )
    const res = await app.fetch(
      new Request('http://x/git/diff?from=../etc/passwd&to=HEAD')
    )
    expect(res.status).toBe(400)
    expect(called).toBe(false)
  })

  it('500s with the shared error envelope on an unknown (well-formed) sha', async () => {
    const { git, app } = makeApp()
    const { sha } = await git.commitFile({
      path: 'a.mdoc',
      content: 'A',
      message: 'm',
      author
    })
    const res = await app.fetch(
      new Request(`http://x/git/diff?from=${'f'.repeat(40)}&to=${sha}`)
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(typeof body.error).toBe('string')
  })
})
