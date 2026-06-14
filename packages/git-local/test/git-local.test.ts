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
    dir = mkdtempSync(join(tmpdir(), 'saytu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })

    const a = createLocalGitAdapter({ dir })
    const { sha } = await a.commitFile({
      path: 'content/hello.mdoc',
      content: '# Hi',
      message: 'add hello',
      author: { name: 'Ed', email: 'ed@x.com' },
    })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    const b = createLocalGitAdapter({ dir })
    expect(await b.headSha()).toBe(sha)
    expect(await b.readFile('content/hello.mdoc')).toBe('# Hi')
  })
})
