import { afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { runGitPortContract } from '@setu/git-testing'
import { createLocalGitAdapter } from '../src/index'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

runGitPortContract(
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    dirs.push(dir)
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
    return createLocalGitAdapter({ dir })
  },
  { history: true } // #466: implements the optional log/readFileAt capability
)
