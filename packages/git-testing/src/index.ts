import { describe, it, expect, beforeEach } from 'vitest'
import type { GitPort } from '@saytu/core'

const author = { name: 'Test', email: 'test@x.com' }

/** Run the GitPort behavioral contract against an adapter. `makeAdapter` must
 *  return a FRESH adapter on an empty repo each call. */
export function runGitPortContract(makeAdapter: () => Promise<GitPort> | GitPort): void {
  describe('GitPort contract', () => {
    let port: GitPort
    beforeEach(async () => {
      port = await makeAdapter()
    })

    it('reports null head and null reads on an empty repo', async () => {
      expect(await port.headSha()).toBeNull()
      expect(await port.readFile('x.mdoc')).toBeNull()
    })

    it('commits a file and returns a string sha that becomes HEAD', async () => {
      const { sha } = await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
      expect(typeof sha).toBe('string')
      expect(sha.length).toBeGreaterThan(0)
      expect(await port.headSha()).toBe(sha)
      expect(await port.headSha()).toBe(sha) // idempotent: reading HEAD does not change it
    })

    it('reads back committed content; null for an uncommitted path', async () => {
      await port.commitFile({ path: 'a.mdoc', content: 'hello', message: 'm', author })
      expect(await port.readFile('a.mdoc')).toBe('hello')
      expect(await port.readFile('missing.mdoc')).toBeNull()
    })

    it('a second commit advances HEAD and reflects the latest content', async () => {
      const first = await port.commitFile({ path: 'a.mdoc', content: 'v1', message: 'm1', author })
      const second = await port.commitFile({ path: 'a.mdoc', content: 'v2', message: 'm2', author })
      expect(second.sha).not.toBe(first.sha)
      expect(await port.headSha()).toBe(second.sha)
      expect(await port.readFile('a.mdoc')).toBe('v2')
    })

    it('committing a second path does not overwrite the first', async () => {
      await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm1', author })
      await port.commitFile({ path: 'b.mdoc', content: 'B', message: 'm2', author })
      expect(await port.readFile('a.mdoc')).toBe('A')
      expect(await port.readFile('b.mdoc')).toBe('B')
    })

    it('commits and reads nested paths (parent dirs created)', async () => {
      await port.commitFile({ path: 'blog/sub/hello.mdoc', content: 'nested', message: 'm', author })
      expect(await port.readFile('blog/sub/hello.mdoc')).toBe('nested')
    })

    it('lists nothing on an empty repo', async () => {
      expect(await port.list()).toEqual([])
    })

    it('lists committed paths, and filters by prefix', async () => {
      await port.commitFile({ path: 'content/post/en/a.mdoc', content: 'A', message: 'm', author })
      await port.commitFile({ path: 'content/page/en/b.mdoc', content: 'B', message: 'm', author })
      await port.commitFile({ path: 'saytu.config.ts', content: 'C', message: 'm', author })

      expect([...(await port.list())].sort()).toEqual([
        'content/page/en/b.mdoc',
        'content/post/en/a.mdoc',
        'saytu.config.ts',
      ])
      expect([...(await port.list('content/post/'))].sort()).toEqual(['content/post/en/a.mdoc'])
      expect(await port.list('content/none/')).toEqual([])
    })
  })
}
