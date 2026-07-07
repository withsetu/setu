import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'

const author = { name: 'T', email: 't@x.com' }

describe('POST /git/commit-files', () => {
  it('commits writes + deletes in one request and reflects them', async () => {
    const app = createGitApi(createMemoryGitPort(), () => ({
      id: 'local',
      role: 'admin'
    }))
    // seed a file to delete
    await app.fetch(
      new Request('http://x/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'old.mdoc',
          content: 'OLD',
          message: 'm',
          author
        })
      })
    )
    const res = await app.fetch(
      new Request('http://x/git/commit-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [
            { path: 'old.mdoc', delete: true },
            { path: 'new.mdoc', content: 'NEW' }
          ],
          message: 'batch',
          author
        })
      })
    )
    expect(res.status).toBe(200)
    const { sha } = (await res.json()) as { sha: string }
    expect(typeof sha).toBe('string')
    const head = (await (
      await app.fetch(new Request('http://x/git/head'))
    ).json()) as { sha: string }
    expect(head.sha).toBe(sha)
    const gone = (await (
      await app.fetch(new Request('http://x/git/file?path=old.mdoc'))
    ).json()) as { content: string | null }
    expect(gone.content).toBeNull()
    const added = (await (
      await app.fetch(new Request('http://x/git/file?path=new.mdoc'))
    ).json()) as { content: string | null }
    expect(added.content).toBe('NEW')
  })
})
