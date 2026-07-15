import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort } from '../git/git-port'
import type { DeployInfo } from '../content-index/list-entries'
import { createIndexService, INDEX_VERSION } from './index-service'

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
// Deploy truth (#208) replaced the old `deployedAt(path)` lookup. These tests assert
// git-diff reindex behaviour (which paths get re-read, when a full rescan happens) — that
// is driven by `deployedHead`/`diffPaths`, not by deploy projection — so a never-deployed
// snapshot is the correct, neutral default here.
const NEVER_DEPLOYED: DeployInfo = { deployedSha: null, changed: [] }
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const

/** Wrap a memory GitPort with call spies: which paths were read, whether the
 *  full-rescan entrypoint (`list`) ran, and whether diffPaths was consulted. */
function spyGit(seed: { path: string; content: string }[]) {
  const base = createMemoryGitPort(seed)
  const reads: string[] = []
  let listCalls = 0
  let diffCalls = 0
  const git: GitPort = {
    ...base,
    async readFile(path: string) {
      reads.push(path)
      return base.readFile(path)
    },
    async list(prefix?: string) {
      listCalls += 1
      return base.list(prefix)
    },
    async diffPaths(fromSha: string, toSha: string) {
      diffCalls += 1
      return base.diffPaths(fromSha, toSha)
    }
  }
  return {
    git,
    reads,
    resetReads: () => reads.splice(0),
    listCalls: () => listCalls,
    diffCalls: () => diffCalls
  }
}

function serviceWith(
  git: GitPort,
  opts: {
    data?: ReturnType<typeof createMemoryDataPort>
    index?: ReturnType<typeof createMemoryIndexPort>
    deploy?: () => DeployInfo
  } = {}
) {
  const data = opts.data ?? createMemoryDataPort()
  const index = opts.index ?? createMemoryIndexPort()
  return {
    data,
    index,
    service: createIndexService({
      data,
      git,
      index,
      deploy: opts.deploy ?? (() => NEVER_DEPLOYED)
    })
  }
}

describe('createIndexService — incremental reindex on out-of-band HEAD change', () => {
  it('re-reads ONLY the changed paths, never rescans, and advances indexedSha', async () => {
    const spy = spyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    const { service, index } = serviceWith(spy.git)
    await service.ensureBuilt()
    const listsAfterBuild = spy.listCalls()
    spy.resetReads()

    const { sha } = await spy.git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B2'),
      message: 'edit',
      author
    })
    await service.ensureBuilt()

    // THE spy proof: only the changed path was read; a.mdoc was never touched.
    expect(spy.reads).toEqual(['content/post/en/b.mdoc'])
    expect(spy.listCalls()).toBe(listsAfterBuild) // no full rescan
    expect((await index.getMeta()).indexedSha).toBe(sha)
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['A', 'B2'])
  })

  it('imports an added file and removes a deleted one WITHOUT reading the deleted path', async () => {
    const spy = spyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/gone.mdoc', content: mdoc('Gone') }
    ])
    const { service } = serviceWith(spy.git)
    await service.ensureBuilt()
    spy.resetReads()

    await spy.git.commitFiles({
      changes: [
        { path: 'content/post/en/new.mdoc', content: mdoc('New') },
        { path: 'content/post/en/gone.mdoc', delete: true }
      ],
      message: 'add+rm',
      author
    })
    await service.ensureBuilt()

    // Deleted paths are dropped from the index without a git read.
    expect(spy.reads).toEqual(['content/post/en/new.mdoc'])
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['A', 'New'])
  })

  it('keeps the draft row when the committed copy of an entry is deleted', async () => {
    const spy = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const { service, data } = serviceWith(spy.git)
    await service.ensureBuilt()
    await data.saveDraft({
      collection: 'post',
      locale: 'en',
      slug: 'a',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'draft body' }]
          }
        ]
      },
      metadata: { title: 'A draft' }
    })
    await spy.git.commitFiles({
      changes: [{ path: 'content/post/en/a.mdoc', delete: true }],
      message: 'rm',
      author
    })
    await service.ensureBuilt()
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title)).toEqual(['A draft'])
    expect(r.rows[0]!.hasDraft).toBe(true)
  })

  it('ignores non-content paths in the diff', async () => {
    const spy = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const { service } = serviceWith(spy.git)
    await service.ensureBuilt()
    spy.resetReads()
    await spy.git.commitFile({
      path: 'settings.json',
      content: '{}',
      message: 'settings',
      author
    })
    await service.ensureBuilt()
    expect(spy.reads).toEqual([]) // nothing content-shaped changed → no reads
    expect((await service.query(q)).total).toBe(1)
  })

  it('falls back to a full rebuild on an INDEX_VERSION bump', async () => {
    const spy = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const { service, index } = serviceWith(spy.git)
    await service.ensureBuilt()
    const meta = await index.getMeta()
    await index.setMeta({ ...meta, version: INDEX_VERSION - 1 })
    const before = spy.listCalls()
    await service.ensureBuilt()
    expect(spy.listCalls()).toBe(before + 1) // full rescan, not a diff
    expect((await service.query(q)).total).toBe(1)
  })

  it('falls back to a full rebuild when indexedSha is missing', async () => {
    const spy = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const { service, index } = serviceWith(spy.git)
    await service.ensureBuilt()
    await index.setMeta({ indexedSha: null, version: INDEX_VERSION })
    const before = spy.listCalls()
    await service.ensureBuilt()
    expect(spy.diffCalls()).toBe(0)
    expect(spy.listCalls()).toBe(before + 1)
    expect((await service.query(q)).total).toBe(1)
  })

  it('falls back to a full rebuild when diffPaths throws (safe rescan, never stale)', async () => {
    const base = spyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') }
    ])
    const git: GitPort = {
      ...base.git,
      async diffPaths() {
        throw new Error('fromSha was pruned')
      }
    }
    const { service } = serviceWith(git)
    await service.ensureBuilt()
    const before = base.listCalls()
    await git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B'),
      message: 'x',
      author
    })
    await service.ensureBuilt()
    expect(base.listCalls()).toBe(before + 1) // rebuilt in full
    expect((await service.query(q)).total).toBe(2) // and nothing went stale
  })
})

describe('createIndexService — reindexAfterDeploy uses the diff path', () => {
  it('first deploy rebuilds in full; later deploys reindex only what changed since the previous one', async () => {
    const spy = spyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    const { service } = serviceWith(spy.git)
    await service.ensureBuilt()

    // Deploy 1: no prior deploy head to diff from → full rebuild.
    const listsBefore = spy.listCalls()
    await service.reindexAfterDeploy()
    expect(spy.listCalls()).toBe(listsBefore + 1)

    // Edit b, sync the index for that commit (the steady-state single-edit path).
    const { sha } = await spy.git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B2'),
      message: 'edit',
      author
    })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    await service.markSyncedAt(sha)

    // Deploy 2: only b changed since deploy 1 → diff path, no rescan, only b re-read.
    const listsAfterFirstDeploy = spy.listCalls()
    spy.resetReads()
    await service.reindexAfterDeploy()
    expect(spy.listCalls()).toBe(listsAfterFirstDeploy) // no full rescan
    expect(spy.reads).toEqual(['content/post/en/b.mdoc'])
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['A', 'B2'])
  })

  it('a deploy with no git movement since the previous deploy is a no-op', async () => {
    const spy = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const { service } = serviceWith(spy.git)
    await service.ensureBuilt()
    await service.reindexAfterDeploy() // first deploy: full rebuild
    const lists = spy.listCalls()
    const diffs = spy.diffCalls()
    spy.resetReads()
    await service.reindexAfterDeploy() // redeploy of the same tree
    expect(spy.listCalls()).toBe(lists)
    expect(spy.diffCalls()).toBe(diffs)
    expect(spy.reads).toEqual([])
  })

  it('falls back to a full rebuild when the deploy diff is unavailable', async () => {
    const base = spyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') }
    ])
    const git: GitPort = {
      ...base.git,
      async diffPaths() {
        throw new Error('unavailable')
      }
    }
    const { service } = serviceWith(git)
    await service.ensureBuilt()
    await service.reindexAfterDeploy() // first deploy: rebuild
    await git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B'),
      message: 'x',
      author
    })
    const before = base.listCalls()
    await service.reindexAfterDeploy()
    expect(base.listCalls()).toBe(before + 1)
    expect((await service.query(q)).total).toBe(2)
  })
})
