import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort } from '../git/git-port'
import type { DeployInfo } from '../content-index/list-entries'
import { createIndexService } from './index-service'

/** #655: the admin used to spell "reindex the entries this commit touched, then
 *  record the commit as synced" as a per-ref loop with a swallowed `.catch()`
 *  followed by an unconditional `markSyncedAt`. A failed reindex therefore stamped
 *  the sha anyway, which defeats `ensureBuilt`'s out-of-band gate: the row is stale
 *  AND the index claims that commit is fully imported, so nothing ever rescans it.
 *  The defect only exists on the failure path, so these drive the REAL index
 *  service over a real memory Git adapter with an injected failing `readFile`. */

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const
const NEVER_DEPLOYED: DeployInfo = { deployedSha: null, changed: [] }

/** A memory GitPort whose `readFile` can be made to reject for chosen paths —
 *  the transient-IO failure the defect hides behind. */
function flakyGit(seed: { path: string; content: string }[]) {
  const base = createMemoryGitPort(seed)
  const failing = new Set<string>()
  const reads: string[] = []
  let listCalls = 0
  const git: GitPort = {
    ...base,
    async readFile(path: string) {
      reads.push(path)
      if (failing.has(path)) throw new Error(`read failed: ${path}`)
      return base.readFile(path)
    },
    async list(prefix?: string) {
      listCalls += 1
      return base.list(prefix)
    }
  }
  return {
    git,
    reads,
    resetReads: () => reads.splice(0),
    listCalls: () => listCalls,
    failReads: (path: string) => failing.add(path),
    healReads: () => failing.clear()
  }
}

function serviceWith(git: GitPort, deploy: () => DeployInfo) {
  const data = createMemoryDataPort()
  const index = createMemoryIndexPort()
  return {
    data,
    index,
    service: createIndexService({ data, git, index, deploy })
  }
}

describe('#655 — reindexEntries never stamps a sha it did not actually index', () => {
  it('a failing reindex leaves indexedSha behind HEAD, so ensureBuilt still imports the commit', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    const { service, index } = serviceWith(spy.git, () => NEVER_DEPLOYED)
    await service.ensureBuilt()
    const shaBefore = (await index.getMeta()).indexedSha

    const { sha } = await spy.git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B2'),
      message: 'edit',
      author
    })

    // The publish path: reindex the changed entry, then mark the commit synced.
    // The reindex fails (transient IO / offline git-http).
    spy.failReads('content/post/en/b.mdoc')
    await expect(
      service.reindexEntries(
        [{ collection: 'post', locale: 'en', slug: 'b' }],
        sha
      )
    ).rejects.toThrow(/read failed/)

    // THE assertion: the sync marker did NOT move. Stamping it here would tell
    // ensureBuilt's out-of-band gate that `sha` is fully imported while b's row is
    // stale — and nothing would ever rescan it again.
    expect((await index.getMeta()).indexedSha).toBe(shaBefore)
    expect((await index.getMeta()).indexedSha).not.toBe(sha)

    // Proof the gate still fires: the stale row self-heals on the next load,
    // WITHOUT anyone calling rebuild().
    spy.healReads()
    await service.ensureBuilt()
    expect((await service.query(q)).rows.map((r) => r.title).sort()).toEqual([
      'A',
      'B2'
    ])
    expect((await index.getMeta()).indexedSha).toBe(sha)
  })

  it('a failing reindex in a BULK batch does not strand a deleted entry as permanently visible', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    const { service, index } = serviceWith(spy.git, () => NEVER_DEPLOYED)
    await service.ensureBuilt()

    const { sha } = await spy.git.commitFiles({
      changes: [{ path: 'content/post/en/b.mdoc', delete: true }],
      message: 'bulk delete',
      author
    })
    // The batch reindexes a (fine) then b (fails) — the ORDER matters: a partial
    // success must still not stamp.
    spy.failReads('content/post/en/b.mdoc')
    await expect(
      service.reindexEntries(
        [
          { collection: 'post', locale: 'en', slug: 'a' },
          { collection: 'post', locale: 'en', slug: 'b' }
        ],
        sha
      )
    ).rejects.toThrow(/read failed/)
    expect((await index.getMeta()).indexedSha).not.toBe(sha)

    // The deleted entry is still in the index right now — but it is RECOVERABLE,
    // which is the whole point: the next load drops it.
    spy.healReads()
    await service.ensureBuilt()
    expect((await service.query(q)).rows.map((r) => r.title)).toEqual(['A'])
  })

  it('the happy path still stamps exactly once, and a null sha stamps nothing', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') }
    ])
    const { service, index } = serviceWith(spy.git, () => NEVER_DEPLOYED)
    await service.ensureBuilt()
    const { sha } = await spy.git.commitFile({
      path: 'content/post/en/a.mdoc',
      content: mdoc('A2'),
      message: 'edit',
      author
    })
    await service.reindexEntries(
      [{ collection: 'post', locale: 'en', slug: 'a' }],
      sha
    )
    expect((await index.getMeta()).indexedSha).toBe(sha)
    expect((await service.query(q)).rows.map((r) => r.title)).toEqual(['A2'])

    // A metadata-only bulk op that committed nothing passes sha = null.
    await service.reindexEntries(
      [{ collection: 'post', locale: 'en', slug: 'a' }],
      null
    )
    expect((await index.getMeta()).indexedSha).toBe(sha)
  })
})
