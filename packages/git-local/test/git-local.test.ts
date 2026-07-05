import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '../src/index'

describe('git-local adapter (on-disk)', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('persists a commit readable by a fresh adapter on the same repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })

    const a = createLocalGitAdapter({ dir })
    const { sha } = await a.commitFile({
      path: 'content/hello.mdoc',
      content: '# Hi',
      message: 'add hello',
      author: { name: 'Ed', email: 'ed@x.com' }
    })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    const b = createLocalGitAdapter({ dir })
    expect(await b.headSha()).toBe(sha)
    expect(await b.readFile('content/hello.mdoc')).toBe('# Hi')
  })

  it('rejects a path that escapes the repository root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
    const a = createLocalGitAdapter({ dir })
    await expect(
      a.commitFile({
        path: '../escape.mdoc',
        content: 'X',
        message: 'm',
        author: { name: 'E', email: 'e@x.com' }
      })
    ).rejects.toThrow(/escape/i)
  })

  it('serializes concurrent commits to different paths without cross-contamination', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
    const a = createLocalGitAdapter({ dir })
    await Promise.all([
      a.commitFile({
        path: 'x.mdoc',
        content: 'X',
        message: 'mx',
        author: { name: 'E', email: 'e@x.com' }
      }),
      a.commitFile({
        path: 'y.mdoc',
        content: 'Y',
        message: 'my',
        author: { name: 'E', email: 'e@x.com' }
      })
    ])
    expect(await a.readFile('x.mdoc')).toBe('X')
    expect(await a.readFile('y.mdoc')).toBe('Y')
  })
})
