import { describe, it, expect } from 'vitest'
import type { GitPort, GitAuthor, CommitInput } from '../../src/index'

describe('GitPort types', () => {
  it('GitAuthor / CommitInput shapes compile and carry expected fields', () => {
    const author: GitAuthor = { name: 'Ed', email: 'ed@x.com' }
    const input: CommitInput = { path: 'a.mdoc', content: 'x', message: 'm', author }
    expect([input.path, input.author.email]).toEqual(['a.mdoc', 'ed@x.com'])
  })

  it('GitPort is structurally implementable', () => {
    const stub: Pick<GitPort, 'headSha'> = { headSha: async () => null }
    expect(typeof stub.headSha).toBe('function')
  })
})
