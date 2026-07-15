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

  async function rebuild(): Promise<void> {
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
      indexedSha: await git.headSha(),
      version: INDEX_VERSION
    })
  }

  async function ensureBuilt(): Promise<void> {
    const meta = await index.getMeta()
    // Cold start / schema change → full build.
    if (meta.version !== INDEX_VERSION) {
      await rebuild()
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
    await rebuild()
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

  async function reindexEntry(ref: EntryRef): Promise<void> {
    await reindexRef(ref, await git.readFile(contentPath(ref)))
  }

  // The git HEAD whose deploy snapshot the index last absorbed (deploys don't move git,
  // they change `deployedAt` for every path that differs from the PREVIOUS deploy — which
  // is exactly diffPaths(previous deploy head, current head)). Session-scoped on purpose:
  // the admin's deploy snapshot is session state too, and a fresh service instance takes
  // the full-rebuild path on its first deploy.
  let deployedHead: string | null = null

  async function reindexAfterDeploy(): Promise<void> {
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
    await rebuild()
  }

  /** Record that the index now reflects committed content at `sha`. The admin calls this
   *  ONCE after it has reindexed every entry a publish/bulk commit changed, so ensureBuilt's
   *  out-of-band sha-gate won't rebuild for that commit. A true out-of-band multi-file commit
   *  (whose entries the admin never reindexed) leaves indexedSha behind HEAD and is imported. */
  async function markSyncedAt(sha: string): Promise<void> {
    const meta = await index.getMeta()
    await index.setMeta({ ...meta, indexedSha: sha })
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
