import { describe, it, expect, beforeEach } from 'vitest'
import type { GitPort } from '@setu/core'

const author = { name: 'Test', email: 'test@x.com' }

/** Run the GitPort behavioral contract against an adapter. `makeAdapter` must
 *  return a FRESH adapter on an empty repo each call. */
export function runGitPortContract(
  makeAdapter: () => Promise<GitPort> | GitPort
): void {
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
      const { sha } = await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      expect(typeof sha).toBe('string')
      expect(sha.length).toBeGreaterThan(0)
      expect(await port.headSha()).toBe(sha)
      expect(await port.headSha()).toBe(sha) // idempotent: reading HEAD does not change it
    })

    it('reads back committed content; null for an uncommitted path', async () => {
      await port.commitFile({
        path: 'a.mdoc',
        content: 'hello',
        message: 'm',
        author
      })
      expect(await port.readFile('a.mdoc')).toBe('hello')
      expect(await port.readFile('missing.mdoc')).toBeNull()
    })

    it('a second commit advances HEAD and reflects the latest content', async () => {
      const first = await port.commitFile({
        path: 'a.mdoc',
        content: 'v1',
        message: 'm1',
        author
      })
      const second = await port.commitFile({
        path: 'a.mdoc',
        content: 'v2',
        message: 'm2',
        author
      })
      expect(second.sha).not.toBe(first.sha)
      expect(await port.headSha()).toBe(second.sha)
      expect(await port.readFile('a.mdoc')).toBe('v2')
    })

    it('committing a second path does not overwrite the first', async () => {
      await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm1',
        author
      })
      await port.commitFile({
        path: 'b.mdoc',
        content: 'B',
        message: 'm2',
        author
      })
      expect(await port.readFile('a.mdoc')).toBe('A')
      expect(await port.readFile('b.mdoc')).toBe('B')
    })

    it('commits and reads nested paths (parent dirs created)', async () => {
      await port.commitFile({
        path: 'blog/sub/hello.mdoc',
        content: 'nested',
        message: 'm',
        author
      })
      expect(await port.readFile('blog/sub/hello.mdoc')).toBe('nested')
    })

    it('lists nothing on an empty repo', async () => {
      expect(await port.list()).toEqual([])
    })

    it('lists committed paths, and filters by prefix', async () => {
      await port.commitFile({
        path: 'content/post/en/a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      await port.commitFile({
        path: 'content/page/en/b.mdoc',
        content: 'B',
        message: 'm',
        author
      })
      await port.commitFile({
        path: 'setu.config.ts',
        content: 'C',
        message: 'm',
        author
      })

      expect([...(await port.list())].sort()).toEqual([
        'content/page/en/b.mdoc',
        'content/post/en/a.mdoc',
        'setu.config.ts'
      ])
      expect([...(await port.list('content/post/'))].sort()).toEqual([
        'content/post/en/a.mdoc'
      ])
      expect(await port.list('content/none/')).toEqual([])
    })

    it('commitFiles writes multiple files in ONE commit', async () => {
      const { sha } = await port.commitFiles({
        changes: [
          { path: 'a.mdoc', content: 'A' },
          { path: 'b.mdoc', content: 'B' }
        ],
        message: 'm',
        author
      })
      expect(await port.headSha()).toBe(sha)
      expect(await port.readFile('a.mdoc')).toBe('A')
      expect(await port.readFile('b.mdoc')).toBe('B')
    })

    it('commitFiles deletes a file', async () => {
      await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      await port.commitFiles({
        changes: [{ path: 'a.mdoc', delete: true }],
        message: 'rm',
        author
      })
      expect(await port.readFile('a.mdoc')).toBeNull()
      expect(await port.list()).toEqual([])
    })

    it('commitFiles mixes a write and a delete in ONE commit', async () => {
      await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      const { sha } = await port.commitFiles({
        changes: [
          { path: 'a.mdoc', delete: true },
          { path: 'b.mdoc', content: 'B' }
        ],
        message: 'm2',
        author
      })
      expect(await port.headSha()).toBe(sha)
      expect(await port.readFile('a.mdoc')).toBeNull()
      expect(await port.readFile('b.mdoc')).toBe('B')
    })

    it('commitFiles with empty changes makes no commit', async () => {
      const { sha: first } = await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      const { sha } = await port.commitFiles({
        changes: [],
        message: 'noop',
        author
      })
      expect(sha).toBe(first)
      expect(await port.headSha()).toBe(first)
    })

    it('commitFiles tolerates deleting an absent path (no commit)', async () => {
      const { sha: first } = await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      const { sha } = await port.commitFiles({
        changes: [{ path: 'ghost.mdoc', delete: true }],
        message: 'noop',
        author
      })
      expect(sha).toBe(first)
      expect(await port.readFile('a.mdoc')).toBe('A')
    })

    it('commitFiles applies same-path changes in order (last wins)', async () => {
      await port.commitFile({
        path: 'x.mdoc',
        content: 'OLD',
        message: 'm',
        author
      })
      // delete then re-write the same path in one batch → write wins
      const a = await port.commitFiles({
        changes: [
          { path: 'x.mdoc', delete: true },
          { path: 'x.mdoc', content: 'OLD' }
        ],
        message: 'b1',
        author
      })
      expect(await port.headSha()).toBe(a.sha)
      expect(await port.readFile('x.mdoc')).toBe('OLD')
      // write then delete the same path in one batch → delete wins
      await port.commitFiles({
        changes: [
          { path: 'x.mdoc', content: 'NEW' },
          { path: 'x.mdoc', delete: true }
        ],
        message: 'b2',
        author
      })
      expect(await port.readFile('x.mdoc')).toBeNull()
    })

    const byPath = (a: { path: string }, b: { path: string }) =>
      a.path < b.path ? -1 : 1

    it('diffPaths reports an added file (and deleted in the reverse direction)', async () => {
      const { sha: from } = await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm1',
        author
      })
      const { sha: to } = await port.commitFile({
        path: 'content/post/en/b.mdoc',
        content: 'B',
        message: 'm2',
        author
      })
      expect(await port.diffPaths(from, to)).toEqual([
        { path: 'content/post/en/b.mdoc', status: 'added' }
      ])
      expect(await port.diffPaths(to, from)).toEqual([
        { path: 'content/post/en/b.mdoc', status: 'deleted' }
      ])
    })

    it('diffPaths reports a modified file', async () => {
      const { sha: from } = await port.commitFile({
        path: 'content/post/en/a.mdoc',
        content: 'v1',
        message: 'm1',
        author
      })
      const { sha: to } = await port.commitFile({
        path: 'content/post/en/a.mdoc',
        content: 'v2',
        message: 'm2',
        author
      })
      expect(await port.diffPaths(from, to)).toEqual([
        { path: 'content/post/en/a.mdoc', status: 'modified' }
      ])
    })

    it('diffPaths reports a deleted file', async () => {
      const { sha: from } = await port.commitFile({
        path: 'content/post/en/a.mdoc',
        content: 'A',
        message: 'm1',
        author
      })
      const { sha: to } = await port.commitFiles({
        changes: [{ path: 'content/post/en/a.mdoc', delete: true }],
        message: 'rm',
        author
      })
      expect(await port.diffPaths(from, to)).toEqual([
        { path: 'content/post/en/a.mdoc', status: 'deleted' }
      ])
    })

    it('diffPaths reports a mixed add/modify/delete across several commits', async () => {
      const { sha: from } = await port.commitFiles({
        changes: [
          { path: 'content/post/en/keep.mdoc', content: 'same' },
          { path: 'content/post/en/edit.mdoc', content: 'v1' },
          { path: 'content/post/en/gone.mdoc', content: 'bye' }
        ],
        message: 'base',
        author
      })
      await port.commitFile({
        path: 'content/post/en/edit.mdoc',
        content: 'v2',
        message: 'edit',
        author
      })
      const { sha: to } = await port.commitFiles({
        changes: [
          { path: 'content/page/en/new.mdoc', content: 'hi' },
          { path: 'content/post/en/gone.mdoc', delete: true }
        ],
        message: 'add+rm',
        author
      })
      expect([...(await port.diffPaths(from, to))].sort(byPath)).toEqual([
        { path: 'content/page/en/new.mdoc', status: 'added' },
        { path: 'content/post/en/edit.mdoc', status: 'modified' },
        { path: 'content/post/en/gone.mdoc', status: 'deleted' }
      ])
    })

    it('diffPaths of identical shas is empty', async () => {
      const { sha } = await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      expect(await port.diffPaths(sha, sha)).toEqual([])
    })

    it('diffPaths rejects on a sha the repo does not know', async () => {
      const { sha } = await port.commitFile({
        path: 'a.mdoc',
        content: 'A',
        message: 'm',
        author
      })
      const unknown = 'f'.repeat(40)
      await expect(port.diffPaths(unknown, sha)).rejects.toThrow()
      await expect(port.diffPaths(sha, unknown)).rejects.toThrow()
    })
  })
}
