import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort } from '../git/git-port'
import type { IndexPort } from './types'
import type { DeployInfo } from '../content-index/list-entries'
import { createIndexService } from './index-service'

// #483: on a cold admin load, ensureBuilt() fires concurrently from several mount/query
// effects (×2 each under StrictMode). Un-coalesced, each call runs a full rebuild on ONE
// shared IndexPort, and rebuild is a multi-step clear→upsertMany→setMeta sequence — so a
// still-running build's clear() can land between another build's upsertMany() and the
// caller's first query(), which then returns 0 rows and the Posts list commits a
// permanently-empty state (the late upsertMany repopulates the store, so post-hoc
// inspection looks fine). These tests pin the contract that prevents that: ensureBuilt
// coalesces to one in-flight build, writers never interleave, and a mid-walk commit
// leaves indexedSha behind HEAD so it is imported, not masked. All interleavings are
// forced with manually-resolved gates — no timers, no timing luck.

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const NEVER_DEPLOYED: DeployInfo = { deployedSha: null, changed: [] }
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const

/** Manually-resolved latch: `await g.opened` blocks until `g.release()`. */
function gate() {
  let release!: () => void
  const opened = new Promise<void>((r) => {
    release = r
  })
  return { opened, release }
}

function serviceWith(git: GitPort, index?: IndexPort) {
  const data = createMemoryDataPort()
  const idx = index ?? createMemoryIndexPort()
  return {
    index: idx,
    service: createIndexService({
      data,
      git,
      index: idx,
      deploy: () => NEVER_DEPLOYED
    })
  }
}

describe('createIndexService — concurrency (#483)', () => {
  it('coalesces concurrent ensureBuilt() calls into ONE in-flight build', async () => {
    const base = createMemoryGitPort([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    // Hold every walk at list() so the first build is provably still in flight
    // when the second ensureBuilt() fires.
    const walkGate = gate()
    const walkStarted = gate()
    let listCalls = 0
    const git: GitPort = {
      ...base,
      async list(prefix?: string) {
        listCalls += 1
        walkStarted.release()
        await walkGate.opened
        return base.list(prefix)
      }
    }
    const { service } = serviceWith(git)

    const p1 = service.ensureBuilt()
    await walkStarted.opened // build 1 is mid-walk, not finished
    const p2 = service.ensureBuilt()
    walkGate.release()
    await Promise.all([p1, p2])

    // One walk, not one per caller (un-coalesced code runs two full builds).
    expect(listCalls).toBe(1)
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['A', 'B'])
  })

  it('serializes writers: a concurrent rebuild never wipes rows out from under a resolved ensureBuilt', async () => {
    const git = createMemoryGitPort([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    const base = createMemoryIndexPort()
    // Ordered event log over the three rebuild steps, with gates arranged so that —
    // under un-serialized writers — build 2's clear() lands after build 1's
    // upsertMany() but before the caller's first query(): the exact #483 corruption.
    const events: string[] = []
    let clears = 0
    let upserts = 0
    const firstClearStarted = gate() // build 1 has reached its clear()
    const firstUpsertDone = gate() // build 1's rows are in the store
    const secondUpsertMayProceed = gate() // holds build 2 open across the query
    const index: IndexPort = {
      ...base,
      async clear() {
        const n = ++clears
        if (n === 1) firstClearStarted.release()
        // Un-serialized, build 2 reaches here mid-build-1 and this gate forces its
        // wipe to land AFTER build 1 populated. Serialized, build 2 only starts
        // after build 1 finished, so the gate is already open — no deadlock.
        if (n === 2) await firstUpsertDone.opened
        events.push('clear')
        await base.clear()
      },
      async upsertMany(rows) {
        const n = ++upserts
        if (n === 2) await secondUpsertMayProceed.opened
        events.push('upsertMany')
        await base.upsertMany(rows)
        if (n === 1) firstUpsertDone.release()
      },
      async setMeta(m) {
        events.push('setMeta')
        await base.setMeta(m)
      }
    }
    const { service } = serviceWith(git, index)

    const p1 = service.ensureBuilt()
    await firstClearStarted.opened // build 1 is provably past its walk
    const p2 = service.rebuild()
    await p1

    // THE #483 assertion: a query issued right after ensureBuilt() resolves sees the
    // rows that build put in — never a concurrent build's half-done wipe.
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['A', 'B'])

    secondUpsertMayProceed.release()
    await p2

    // Writers fully serialized: two complete clear→upsertMany→setMeta sequences,
    // never interleaved.
    expect(events).toEqual([
      'clear',
      'upsertMany',
      'setMeta',
      'clear',
      'upsertMany',
      'setMeta'
    ])
  })

  it('stamps the PRE-walk head sha so a commit landing mid-walk is imported, not masked', async () => {
    const base = createMemoryGitPort([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') }
    ])
    // Land a new commit while the walk is in progress: hook the first readFile,
    // which runs after list() returned (so the walk never sees late.mdoc).
    let landed = false
    const git: GitPort = {
      ...base,
      async readFile(path: string) {
        if (!landed) {
          landed = true
          await base.commitFile({
            path: 'content/post/en/late.mdoc',
            content: mdoc('Late'),
            message: 'mid-walk commit',
            author
          })
        }
        return base.readFile(path)
      }
    }
    const preWalkHead = await base.headSha()
    const { service, index } = serviceWith(git)

    await service.rebuild()
    // indexedSha must stay BEHIND the mid-walk commit — stamping the post-walk head
    // would mark the unwalked commit as indexed and mask it forever.
    expect((await index.getMeta()).indexedSha).toBe(preWalkHead)

    await service.ensureBuilt() // incremental import picks the late commit up
    const r = await service.query(q)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['A', 'Late'])
  })
})
