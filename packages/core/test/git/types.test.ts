import { describe, it, expect } from 'vitest'
import type { GitPort, GitAuthor, CommitInput } from '../../src/index'

describe('GitPort types', () => {
  it('GitAuthor / CommitInput shapes compile and carry expected fields', () => {
    const author: GitAuthor = { name: 'Ed', email: 'ed@x.com' }
    const input: CommitInput = {
      path: 'a.mdoc',
      content: 'x',
      message: 'm',
      author
    }
    expect([input.path, input.author.email]).toEqual(['a.mdoc', 'ed@x.com'])
  })

  it('GitPort is structurally implementable (all methods)', async () => {
    const stub: GitPort = {
      headSha: async () => null,
      readFile: async () => null,
      commitFile: async () => ({ sha: 'deadbeef' }),
      commitFiles: async () => ({ sha: 'deadbeef' }),
      list: async () => [],
      diffPaths: async () => []
    }
    expect(await stub.headSha()).toBeNull()
    expect(
      await stub.commitFile({
        path: 'a.mdoc',
        content: 'x',
        message: 'm',
        author: { name: 'E', email: 'e@x.com' }
      })
    ).toEqual({ sha: 'deadbeef' })
  })
})
