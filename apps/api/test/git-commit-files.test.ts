import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type {
  GitPort,
  CommitInput,
  CommitFilesInput,
  GitAuthor
} from '@setu/core'

const author = { name: 'T', email: 't@x.com' }

/** Wraps a real GitPort, recording every `author` actually handed to commitFile/commitFiles.
 *  @setu/git-memory doesn't retain commit authorship for later inspection (its commit sha is a
 *  content hash with no author field), so this spy is how #382's server-stamping is observed: it
 *  proves what the ROUTE passed to the port, not what the client's request body said. Real writes
 *  still land in `git` — only the author argument is intercepted. */
function spyOnAuthor(git: GitPort): { port: GitPort; calls: GitAuthor[] } {
  const calls: GitAuthor[] = []
  const port: GitPort = {
    ...git,
    commitFile(input: CommitInput) {
      calls.push(input.author)
      return git.commitFile(input)
    },
    commitFiles(input: CommitFilesInput) {
      calls.push(input.author)
      return git.commitFiles(input)
    }
  }
  return { port, calls }
}

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

// #382 — the client-supplied `author` was trusted as-is, so any caller could stamp an arbitrary
// name/email on a commit. The route must now stamp the session-resolved identity (`gitAuthor`)
// over whatever the body claims.
describe('POST /git/commit and /git/commit-files — server-stamped author (#382)', () => {
  const sessionAuthor = { name: 'Real Name', email: 'real@x.dev' }
  const spoofedAuthor = { name: 'Spoof', email: 'spoof@x.dev' }

  it('stamps the session identity as commit author, ignoring a body-supplied author', async () => {
    const { port, calls } = spyOnAuthor(createMemoryGitPort())
    const app = createGitApi(port, () => ({
      id: 'u1',
      role: 'admin',
      gitAuthor: sessionAuthor
    }))
    const res = await app.fetch(
      new Request('http://x/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'p.mdoc',
          content: 'X',
          message: 'm',
          author: spoofedAuthor
        })
      })
    )
    expect(res.status).toBe(200)
    expect(calls).toEqual([sessionAuthor])
  })

  it('stamps the session identity on /git/commit-files too, ignoring a body-supplied author', async () => {
    const { port, calls } = spyOnAuthor(createMemoryGitPort())
    const app = createGitApi(port, () => ({
      id: 'u1',
      role: 'admin',
      gitAuthor: sessionAuthor
    }))
    const res = await app.fetch(
      new Request('http://x/git/commit-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [{ path: 'p.mdoc', content: 'X' }],
          message: 'm',
          author: spoofedAuthor
        })
      })
    )
    expect(res.status).toBe(200)
    expect(calls).toEqual([sessionAuthor])
  })

  it('falls back to the body-supplied author when the resolver has no gitAuthor (dev/local mode)', async () => {
    const { port, calls } = spyOnAuthor(createMemoryGitPort())
    const app = createGitApi(port, () => ({ id: 'local', role: 'admin' }))
    const res = await app.fetch(
      new Request('http://x/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'p.mdoc',
          content: 'X',
          message: 'm',
          author: spoofedAuthor
        })
      })
    )
    expect(res.status).toBe(200)
    expect(calls).toEqual([spoofedAuthor])
  })
})
