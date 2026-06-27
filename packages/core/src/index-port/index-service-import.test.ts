import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIndexService } from './index-service'

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const

// Wrap a memory GitPort so we can count rebuilds (rebuild() is the only caller of git.list).
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

    // Out-of-band: a new file committed directly, not through the admin.
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
    expect(listCalls()).toBe(before) // no extra rebuild
  })

  it('never loops on an empty repo (HEAD null)', async () => {
    const { git, listCalls } = spyGit([])
    const service = serviceWith(git)
    await service.ensureBuilt() // version gate → one (empty) rebuild
    const before = listCalls()
    await service.ensureBuilt()
    await service.ensureBuilt()
    expect(listCalls()).toBe(before) // head null → no further rebuilds
  })

  it('reindexEntry syncs indexedSha so a normal edit does not force a full rebuild', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    // Admin-style commit + incremental reindex (what publish does).
    await git.commitFile({ path: 'content/post/en/a.mdoc', content: mdoc('A2'), message: 'edit', author })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    const before = listCalls()
    await service.ensureBuilt() // indexedSha now === HEAD → must NOT rebuild
    expect(listCalls()).toBe(before)
  })
})
