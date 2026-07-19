import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort } from '../git/git-port'
import type { DeployInfo } from '../content-index/list-entries'
import { createIndexService, INDEX_VERSION } from './index-service'

/** #662: which deploy the index rows reflect is derived state, and it used to be
 *  handled two ways that both lose it.
 *  (a) `reindexAfterDeploy` assigned the absorbed marker BEFORE the work that can
 *      throw, and `applyDiff` only guarded `diffPaths` — so a `readFile` rejection
 *      in its per-path loop escaped after the marker had moved, and the retry saw
 *      from === head and no-op'd. Row stuck at `staged` while `rebuild()` said `live`.
 *  (b) the marker was a session-scoped local while the index is PERSISTENT, so an
 *      out-of-band deploy (CI, a Pages hook, another session) plus a restart left
 *      every row's live/staged state wrong until someone hit `/api/index/refresh`.
 *  Both live on failure/restart paths, so these drive the REAL index service over a
 *  real memory Git adapter with an injected failing `readFile`. */

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const
const NEVER_DEPLOYED: DeployInfo = { deployedSha: null, changed: [] }

/** A memory GitPort whose `readFile` can be made to reject for chosen paths. */
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

/** `shared` lets a test build a SECOND service over the same persistent DB state —
 *  the restart the #662b defect hides behind. */
function serviceWith(
  git: GitPort,
  deploy: () => DeployInfo,
  shared?: {
    data?: ReturnType<typeof createMemoryDataPort>
    index?: ReturnType<typeof createMemoryIndexPort>
  }
) {
  const data = shared?.data ?? createMemoryDataPort()
  const index = shared?.index ?? createMemoryIndexPort()
  return {
    data,
    index,
    service: createIndexService({ data, git, index, deploy })
  }
}

describe('#662a — the absorbed-deploy sha is committed only after the work succeeds', () => {
  it('a per-path read failure during the deploy diff does not consume the deploy', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    let deploy: DeployInfo = NEVER_DEPLOYED
    const { service, index } = serviceWith(spy.git, () => deploy)
    await service.ensureBuilt()
    const sha0 = await spy.git.headSha()
    deploy = { deployedSha: sha0, changed: [] }
    await service.reindexAfterDeploy() // deploy 1 → full rebuild, absorbs sha0
    const absorbed = (await index.getMeta()).deployedSha
    expect(absorbed).toBe(sha0)

    const { sha } = await spy.git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B2'),
      message: 'edit',
      author
    })
    await service.reindexEntries(
      [{ collection: 'post', locale: 'en', slug: 'b' }],
      sha
    )

    // Deploy 2, but b's read fails. applyDiff only guarded `diffPaths`, so the
    // rejection escaped AFTER `deployedHead = head` had already been assigned.
    deploy = { deployedSha: sha, changed: [] }
    spy.failReads('content/post/en/b.mdoc')
    await expect(service.reindexAfterDeploy()).rejects.toThrow(/read failed/)

    // THE assertion: the deploy was not marked absorbed. Pre-fix this had advanced
    // to `sha`, so the retry below computed from === head and no-op'd — leaving the
    // row stuck on the previous deploy's lifecycle forever.
    expect((await index.getMeta()).deployedSha).toBe(absorbed)

    // The retry genuinely re-derives b instead of short-circuiting.
    spy.healReads()
    spy.resetReads()
    await service.reindexAfterDeploy()
    expect(spy.reads).toContain('content/post/en/b.mdoc')
    expect((await index.getMeta()).deployedSha).toBe(sha)
  })

  it('a read failure inside applyDiff degrades to the full rebuild rather than escaping', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    const { service } = serviceWith(spy.git, () => NEVER_DEPLOYED)
    await service.ensureBuilt()

    // A path that vanishes from the object store between diffPaths and readFile:
    // the diff still names it, the read rejects. That must trigger the safe
    // rescan (the same fallback a throwing diffPaths gets), not a rejected
    // ensureBuilt that leaves the caller with a half-applied index.
    await spy.git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B2'),
      message: 'edit',
      author
    })
    const listsBefore = spy.listCalls()
    spy.failReads('content/post/en/b.mdoc')
    await expect(service.ensureBuilt()).rejects.toThrow(/read failed/)
    // It reached the full-rescan fallback (which then hit the same dead path).
    expect(spy.listCalls()).toBe(listsBefore + 1)
  })
})

describe('#662b — the absorbed-deploy sha survives a restart', () => {
  it('a new service instance picks up an out-of-band deploy without POST /api/index/refresh', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') },
      { path: 'content/post/en/b.mdoc', content: mdoc('B') }
    ])
    // Persistent DB state shared across both "processes".
    const data = createMemoryDataPort()
    const index = createMemoryIndexPort()

    const sha0 = await spy.git.headSha()
    const { sha: sha1 } = await spy.git.commitFile({
      path: 'content/post/en/b.mdoc',
      content: mdoc('B2'),
      message: 'edit',
      author
    })

    // Process 1: live site is at sha0, so b is committed-but-not-live.
    let deploy: DeployInfo = {
      deployedSha: sha0,
      changed: [{ path: 'content/post/en/b.mdoc', added: false }]
    }
    const first = serviceWith(spy.git, () => deploy, { data, index })
    await first.service.ensureBuilt()
    const bBefore = (await first.service.query(q)).rows.find(
      (r) => r.ref.slug === 'b'
    )!
    expect(bBefore.lifecycle).toEqual({ state: 'live', pending: 'staged' })
    expect((await index.getMeta()).deployedSha).toBe(sha0)

    // ── restart ── CI (or a Pages hook, or another session) deployed sha1 while
    // this process was down. Git HEAD did not move, so the indexedSha gate is
    // quiet; only the deploy sha changed.
    deploy = { deployedSha: sha1, changed: [] }
    const second = serviceWith(spy.git, () => deploy, { data, index })
    await second.service.ensureBuilt()

    // THE assertion: b is live with nothing pending. Pre-fix, IndexMeta had no
    // deployed sha at all, so the fresh instance started from `deployedHead = null`,
    // ensureBuilt saw HEAD === indexedSha and returned — every row kept reporting
    // the PREVIOUS deploy's live/staged state until someone hit /api/index/refresh.
    const bAfter = (await second.service.query(q)).rows.find(
      (r) => r.ref.slug === 'b'
    )!
    expect(bAfter.lifecycle).toEqual({ state: 'live' })
    expect((await index.getMeta()).deployedSha).toBe(sha1)
  })

  it('an unchanged deploy sha does not re-run the deploy diff on every ensureBuilt', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') }
    ])
    const sha0 = await spy.git.headSha()
    const deploy: DeployInfo = { deployedSha: sha0, changed: [] }
    const { service, index } = serviceWith(spy.git, () => deploy)
    await service.ensureBuilt()
    expect((await index.getMeta()).deployedSha).toBe(sha0)

    const listsBefore = spy.listCalls()
    spy.resetReads()
    await service.ensureBuilt()
    await service.ensureBuilt()
    // No rescan, no re-reads — the gate is quiet once the deploy is absorbed.
    expect(spy.listCalls()).toBe(listsBefore)
    expect(spy.reads).toEqual([])
  })

  it('a version bump rebuilds and re-absorbs the current deploy sha', async () => {
    const spy = flakyGit([
      { path: 'content/post/en/a.mdoc', content: mdoc('A') }
    ])
    const sha0 = await spy.git.headSha()
    const deploy: DeployInfo = { deployedSha: sha0, changed: [] }
    const { service, index } = serviceWith(spy.git, () => deploy)
    await service.ensureBuilt()
    await index.setMeta({
      ...(await index.getMeta()),
      version: INDEX_VERSION - 1,
      deployedSha: null
    })
    await service.ensureBuilt()
    const meta = await index.getMeta()
    expect(meta.version).toBe(INDEX_VERSION)
    expect(meta.deployedSha).toBe(sha0)
  })
})
