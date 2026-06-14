import { describe, it, expect } from 'vitest'
import { runGitPortContract } from '@saytu/git-testing'
import { createMemoryGitPort } from '../src/index'

runGitPortContract(() => createMemoryGitPort())

describe('createMemoryGitPort seed', () => {
  it('applies seed files as initial commits (non-null head + readable)', async () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/hello.mdoc', content: '# Hello\n' }])
    expect(await git.headSha()).not.toBeNull()
    expect(await git.readFile('content/post/en/hello.mdoc')).toBe('# Hello\n')
    expect(await git.readFile('missing.mdoc')).toBeNull()
  })
})
