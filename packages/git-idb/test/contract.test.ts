import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { runGitPortContract } from '@setu/git-testing'
import { createIdbGitPort } from '../src/index'

const author = { name: 'Test', email: 'test@x.com' }
let n = 0
const freshName = () => `git-idb-test-${(n += 1)}`

runGitPortContract(() => createIdbGitPort(freshName()))

describe('createIdbGitPort persistence', () => {
  it('restores committed content after reopening the same database', async () => {
    const name = freshName()
    const a = await createIdbGitPort(name)
    await a.commitFile({
      path: 'content/post/en/a.mdoc',
      content: 'A',
      message: 'm',
      author
    })
    const headA = await a.headSha()

    const b = await createIdbGitPort(name)
    expect(await b.readFile('content/post/en/a.mdoc')).toBe('A')
    expect(await b.list('content/')).toEqual(['content/post/en/a.mdoc'])
    expect(await b.headSha()).toBe(headA)
  })
})
