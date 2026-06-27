import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIndexService } from './index-service'

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const

// Wrap a memory GitPort to count rebuilds (rebuild() is the only caller of git.list).
function spyGit(seed: { path: string; content: string }[]) {
  const base = createMemoryGitPort(seed)
  let listCalls = 0
  const git = { ...base, async list(prefix?: string) { listCalls++; return base.list(prefix) } }
  return { git, listCalls: () => listCalls }
}

function serviceWith(git: ReturnType<typeof spyGit>['git']) {
  return createIndexService({
    data: createMemoryDataPort(),
    git,
    index: createMemoryIndexPort(),
    deployedAt: () => null,
  })
}

describe('createIndexService — out-of-band content import', () => {
  it('imports content committed out-of-band (rebuilds when HEAD moved past indexedSha)', async () => {
    const { git } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    expect((await service.query(q)).total).toBe(1)
    await git.commitFile({ path: 'content/post/en/b.mdoc', content: mdoc('B'), message: 'seed', author })
    await service.ensureBuilt()
    expect((await service.query(q)).total).toBe(2)
  })

  it('does not rebuild when the index is already in sync (HEAD === indexedSha)', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    const before = listCalls()
    await service.ensureBuilt()
    expect(listCalls()).toBe(before)
  })

  it('never loops on an empty repo (HEAD null)', async () => {
    const { git, listCalls } = spyGit([])
    const service = serviceWith(git)
    await service.ensureBuilt()
    const before = listCalls()
    await service.ensureBuilt()
    await service.ensureBuilt()
    expect(listCalls()).toBe(before)
  })

  it('imports ALL files from a multi-file out-of-band commit even if only one was reindexed', async () => {
    const { git } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    // One out-of-band commit adds b AND c.
    await git.commitFiles({
      changes: [
        { path: 'content/post/en/b.mdoc', content: mdoc('B') },
        { path: 'content/post/en/c.mdoc', content: mdoc('C') },
      ],
      message: 'seed two',
      author,
    })
    // The admin reindexes only ONE of them (e.g. the user opened+saved b) and does NOT markSyncedAt.
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    await service.ensureBuilt() // indexedSha still lags HEAD → full rebuild imports a, b AND c
    expect((await service.query(q)).total).toBe(3)
  })

  it('reindexEntry alone does NOT advance indexedSha (next load still imports)', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    await git.commitFile({ path: 'content/post/en/b.mdoc', content: mdoc('B'), message: 'x', author })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    const before = listCalls()
    await service.ensureBuilt() // indexedSha lags → rebuild
    expect(listCalls()).toBeGreaterThan(before)
  })

  it('markSyncedAt after reindexing the changed entry prevents a full rebuild on next load', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    const { sha } = await git.commitFile({ path: 'content/post/en/a.mdoc', content: mdoc('A2'), message: 'edit', author })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    await service.markSyncedAt(sha) // admin marks synced after reindexing the commit's entries
    const before = listCalls()
    await service.ensureBuilt() // indexedSha === HEAD → no rebuild
    expect(listCalls()).toBe(before)
  })
})
