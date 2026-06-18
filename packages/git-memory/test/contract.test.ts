import { describe, it, expect } from 'vitest'
import { runGitPortContract } from '@setu/git-testing'
import { createMemoryGitPort } from '../src/index'

runGitPortContract(() => createMemoryGitPort())

describe('createMemoryGitPort seed', () => {
  it('applies seed files as initial commits (non-null head + readable)', async () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/hello.mdoc', content: '# Hello\n' }])
    expect(await git.headSha()).not.toBeNull()
    expect(await git.readFile('content/post/en/hello.mdoc')).toBe('# Hello\n')
    expect(await git.readFile('missing.mdoc')).toBeNull()
  })

  it('lists seeded files (filtered by prefix)', async () => {
    const git = createMemoryGitPort([
      { path: 'content/post/en/hello.mdoc', content: '# Hello\n' },
      { path: 'setu.config.ts', content: 'export default {}' },
    ])
    expect(await git.list('content/')).toEqual(['content/post/en/hello.mdoc'])
  })
})
