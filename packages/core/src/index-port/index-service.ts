import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { DiffPathEntry } from '../git/types'
import type { EntryRef } from '../data/types'
import type { ContentRow, DeployInfo } from '../content-index/list-entries'
import { listContentEntries } from '../content-index/list-entries'
import { contentPath, parseContentPath } from '../publish/content-path'
import type { IndexPort, IndexQuery } from './types'
import { indexKey, projectRow, rowToContentRow } from './types'

// v5: rows now carry `featuredImage` (for list/preview thumbnails) — bump forces a rebuild
// so existing indexes backfill the new field.
// v6: rows now carry `date` (frontmatter date ?? pubDate, for pattern-aware URLs) — bump
// forces a rebuild so existing indexes backfill the new field.
export const INDEX_VERSION = 6

export interface IndexServiceDeps {
  data: DataPort
  git: GitPort
  index: IndexPort
  /** Live getter for deploy truth (#208) — the service is long-lived, deploys happen. */
  deploy: () => DeployInfo
}

export interface IndexService {
  rebuild(): Promise<void>
  ensureBuilt(): Promise<void>
  reindexEntry(ref: EntryRef): Promise<void>
  reindexAfterDeploy(): Promise<void>
  markSyncedAt(sha: string): Promise<void>
  query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }>
  distinctTags(prefix: string, limit: number): Promise<string[]>
  distinctLocales(): Promise<string[]>
  categoryCounts(): Promise<Record<string, number>>
  tagCounts(): Promise<Record<string, number>>
  referencedBy(
    mediaKey: string
  ): Promise<import('./referenced-by').MediaUsage[]>
  entriesByCategory(slug: string): Promise<import('../data/types').EntryRef[]>
  entriesByTag(tag: string): Promise<import('../data/types').EntryRef[]>
}

export function createIndexService(deps: IndexServiceDeps): IndexService {
  const { data, git, index, deploy } = deps

  // Serialize index WRITERS (#483): every build is a multi-step clear→upsertMany→setMeta
  // sequence on one shared IndexPort, so concurrent builds interleave — a still-running
  // build's clear() landing between another build's upsertMany() and the caller's first
  // query() returned 0 rows, and the admin list committed a permanently-empty state
  // (the late upsertMany silently repopulated the store afterwards). Same idiom as
  // git-local's commit chain. Reads (query/distinct*/counts/…) stay unserialized.
  // Internal callers use the *Inner functions — routing them through serialize() would
  // deadlock the chain.
  let chain: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async function rebuildInner(): Promise<void> {
    // Read HEAD before the walk: a commit landing mid-walk must leave indexedSha behind
    // HEAD so the next ensureBuilt imports it — stamping the post-walk sha would mark
    // the unwalked commit as indexed and mask it forever.
    const head = await git.headSha()
    const drafts = await data.listDrafts()
    const committed: { ref: EntryRef; content: string }[] = []
    for (const p of await git.list('content/')) {
      const ref = parseContentPath(p)
      if (ref === null) continue
      const content = await git.readFile(p)
      if (content !== null) committed.push({ ref, content })
    }
    const rows = listContentEntries({
      drafts,
      committed,
      deploy: deploy()
    }).map(projectRow)
    await index.clear()
    await index.upsertMany(rows)
    await index.setMeta({
      indexedSha: head,
      version: INDEX_VERSION
    })
  }

  function rebuild(): Promise<void> {
    return serialize(rebuildInner)
  }

  async function ensureBuiltInner(): Promise<void> {
    const meta = await index.getMeta()
    // Cold start / schema change → full build.
    if (meta.version !== INDEX_VERSION) {
      await rebuildInner()
      return
    }
    // Import content that changed out-of-band (seeded, directly committed, or the admin
    // pointed at a different repo): the index is stale when its recorded sha lags the live
    // HEAD. A null HEAD (empty default repo) never triggers this, so there is no rebuild loop.
    const head = await git.headSha()
    if (head === null || head === meta.indexedSha) return
    // Incremental import (#450): reindex only the paths the tree diff names, then stamp
    // the new sha. No stored sha, or a diff the adapter cannot produce (sha pruned,
    // pre-diff snapshot store) → full rebuild — fail toward the safe rescan, never a
    // stale index.
    if (meta.indexedSha !== null && (await applyDiff(meta.indexedSha, head))) {
      await index.setMeta({ ...(await index.getMeta()), indexedSha: head })
      return
    }
    await rebuildInner()
  }

  // Coalesce concurrent ensureBuilt() (#483): a cold admin load fires it from several
  // mount/query effects at once (×2 each under StrictMode) — every caller wants "the
  // index is ready", not its own walk, so they all share ONE in-flight build. Direct
  // rebuild() calls intentionally do NOT coalesce: they queue a fresh walk (e.g.
  // reindexAfterDeploy must absorb new deploy state).
  let inflightEnsure: Promise<void> | null = null
  function ensureBuilt(): Promise<void> {
    inflightEnsure ??= serialize(ensureBuiltInner).finally(() => {
      inflightEnsure = null
    })
    return inflightEnsure
  }

  /** Reindex only the content entries `diffPaths(fromSha, toSha)` names: deleted paths
   *  drop their row without a git read; added/modified paths re-read just that file.
   *  Returns false when the diff is unavailable (adapter threw) so callers fall back
   *  to the full rebuild. */
  async function applyDiff(fromSha: string, toSha: string): Promise<boolean> {
    let changes: DiffPathEntry[]
    try {
      changes = await git.diffPaths(fromSha, toSha)
    } catch {
      return false
    }
    for (const ch of changes) {
      const ref = parseContentPath(ch.path)
      if (ref === null) continue
      if (ch.status === 'deleted') await reindexRef(ref, null)
      else await reindexRef(ref, await git.readFile(ch.path))
    }
    return true
  }

  /** Re-derive one entry's row from its draft + the given committed content
   *  (null = no committed copy — skips the git read for known-deleted paths). */
  async function reindexRef(
    ref: EntryRef,
    committedStr: string | null
  ): Promise<void> {
    const draft = await data.getDraft(ref)
    const drafts = draft ? [draft] : []
    const committed =
      committedStr !== null ? [{ ref, content: committedStr }] : []
    const rows = listContentEntries({ drafts, committed, deploy: deploy() })
    if (rows.length === 0) await index.remove(indexKey(ref))
    else await index.upsert(projectRow(rows[0]!))
  }

  function reindexEntry(ref: EntryRef): Promise<void> {
    return serialize(async () =>
      reindexRef(ref, await git.readFile(contentPath(ref)))
    )
  }

  // The git HEAD whose deploy snapshot the index last absorbed (deploys don't move git,
  // they change `deployedAt` for every path that differs from the PREVIOUS deploy — which
  // is exactly diffPaths(previous deploy head, current head)). Session-scoped on purpose:
  // the admin's deploy snapshot is session state too, and a fresh service instance takes
  // the full-rebuild path on its first deploy.
  let deployedHead: string | null = null

  async function reindexAfterDeployInner(): Promise<void> {
    const head = await git.headSha()
    const from = deployedHead
    deployedHead = head
    if (from !== null && head !== null) {
      if (from === head) return // redeploy of the same tree → no row changes
      // NOTE: intentionally does NOT advance meta.indexedSha — this path only refreshes
      // deploy-derived lifecycle; committed-content sync stays owned by ensureBuilt/
      // markSyncedAt so an unimported out-of-band commit is never masked.
      if (await applyDiff(from, head)) return
    }
    await rebuildInner()
  }

  function reindexAfterDeploy(): Promise<void> {
    return serialize(reindexAfterDeployInner)
  }

  /** Record that the index now reflects committed content at `sha`. The admin calls this
   *  ONCE after it has reindexed every entry a publish/bulk commit changed, so ensureBuilt's
   *  out-of-band sha-gate won't rebuild for that commit. A true out-of-band multi-file commit
   *  (whose entries the admin never reindexed) leaves indexedSha behind HEAD and is imported. */
  function markSyncedAt(sha: string): Promise<void> {
    return serialize(async () => {
      const meta = await index.getMeta()
      await index.setMeta({ ...meta, indexedSha: sha })
    })
  }

  async function query(
    q: IndexQuery
  ): Promise<{ rows: ContentRow[]; total: number }> {
    const { rows, total } = await index.query(q)
    return { rows: rows.map(rowToContentRow), total }
  }

  async function distinctTags(
    prefix: string,
    limit: number
  ): Promise<string[]> {
    return index.distinctTags(prefix, limit)
  }

  async function distinctLocales(): Promise<string[]> {
    return index.distinctLocales()
  }

  async function categoryCounts(): Promise<Record<string, number>> {
    return index.categoryCounts()
  }

  async function tagCounts(): Promise<Record<string, number>> {
    return index.tagCounts()
  }

  async function referencedBy(
    mediaKey: string
  ): Promise<import('./referenced-by').MediaUsage[]> {
    return index.referencedBy(mediaKey)
  }

  async function entriesByCategory(
    slug: string
  ): Promise<import('../data/types').EntryRef[]> {
    return index.entriesByCategory(slug)
  }

  async function entriesByTag(
    tag: string
  ): Promise<import('../data/types').EntryRef[]> {
    return index.entriesByTag(tag)
  }

  return {
    rebuild,
    ensureBuilt,
    reindexEntry,
    reindexAfterDeploy,
    markSyncedAt,
    query,
    distinctTags,
    distinctLocales,
    categoryCounts,
    tagCounts,
    referencedBy,
    entriesByCategory,
    entriesByTag
  }
}
