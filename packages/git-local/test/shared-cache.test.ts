// #504: the adapter must thread ONE long-lived cache object through every
// isomorphic-git call that accepts one — without it, each readBlob re-parses
// the commit/tree/pack-index from scratch and a cold index build over N
// entries costs O(N²) (measured ~70 s at 10k entries).
//
// This spec pins the seam itself (same `cache` identity on every call, scoped
// per adapter instance); the behavioral freshness guarantees live in
// git-local.test.ts ("stays fresh after out-of-band commits").
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '../src/index'

// Record the `cache` argument of every object-reading/writing isomorphic-git
// call the adapter makes. `resolveRef` takes no cache (refs are always read
// from disk — that is what keeps HEAD fresh), so it is not wrapped.
const seenCaches: object[] = []
vi.mock('isomorphic-git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('isomorphic-git')>()
  const wrap =
    <A extends { cache?: object }, R>(fn: (args: A) => R) =>
    (args: A): R => {
      seenCaches.push(args.cache as object)
      return fn(args)
    }
  return {
    ...actual,
    readBlob: wrap(actual.readBlob),
    readCommit: wrap(actual.readCommit),
    listFiles: wrap(actual.listFiles),
    walk: wrap(actual.walk),
    log: wrap(actual.log),
    add: wrap(actual.add),
    remove: wrap(actual.remove),
    commit: wrap(actual.commit),
    resetIndex: wrap(actual.resetIndex)
  }
})

const author = { name: 'Test', email: 'test@x.com' }
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
  seenCaches.length = 0
})

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'setu-git-cache-'))
  dirs.push(dir)
  await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
  return dir
}

describe('git-local shared isomorphic-git cache (#504)', () => {
  it('passes one identical cache object to every isomorphic-git call of an adapter', async () => {
    const dir = await makeRepo()
    const a = createLocalGitAdapter({ dir })

    const { sha: first } = await a.commitFile({
      path: 'content/post/en/a.mdoc',
      content: 'v1',
      message: 'm1',
      author
    })
    const { sha: second } = await a.commitFile({
      path: 'content/post/en/a.mdoc',
      content: 'v2',
      message: 'm2',
      author
    })
    await a.readFile('content/post/en/a.mdoc')
    await a.list('content/')
    await a.diffPaths(first, second)
    await a.log!('content/post/en/a.mdoc')
    await a.readFileAt!(first, 'content/post/en/a.mdoc')

    expect(seenCaches.length).toBeGreaterThan(0)
    for (const c of seenCaches) {
      expect(c).toBeTypeOf('object')
      expect(c).not.toBeNull()
      expect(c).toBe(seenCaches[0]) // ONE shared cache, not a fresh {} per call
    }
  })

  it('scopes the cache per adapter instance (two adapters never share one)', async () => {
    const dirA = await makeRepo()
    const a = createLocalGitAdapter({ dir: dirA })
    await a.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
    const cacheA = seenCaches[0]

    seenCaches.length = 0
    const dirB = await makeRepo()
    const b = createLocalGitAdapter({ dir: dirB })
    await b.commitFile({ path: 'b.mdoc', content: 'B', message: 'm', author })
    const cacheB = seenCaches[0]

    expect(cacheA).toBeTypeOf('object')
    expect(cacheB).toBeTypeOf('object')
    expect(cacheB).not.toBe(cacheA)
  })
})
