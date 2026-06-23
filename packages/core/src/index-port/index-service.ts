import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { EntryRef } from '../data/types'
import type { ContentRow } from '../content-index/list-entries'
import { listContentEntries } from '../content-index/list-entries'
import { contentPath, parseContentPath } from '../publish/content-path'
import type { IndexPort, IndexQuery } from './types'
import { indexKey, projectRow, rowToContentRow } from './types'

export const INDEX_VERSION = 4

export interface IndexServiceDeps {
  data: DataPort
  git: GitPort
  index: IndexPort
  deployedAt: (path: string) => string | null
}

export interface IndexService {
  rebuild(): Promise<void>
  ensureBuilt(): Promise<void>
  reindexEntry(ref: EntryRef): Promise<void>
  reindexAfterDeploy(): Promise<void>
  query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }>
  distinctTags(prefix: string, limit: number): Promise<string[]>
  distinctLocales(): Promise<string[]>
  categoryCounts(): Promise<Record<string, number>>
  referencedBy(mediaKey: string): Promise<import('./referenced-by').MediaUsage[]>
}

export function createIndexService(deps: IndexServiceDeps): IndexService {
  const { data, git, index, deployedAt } = deps

  async function rebuild(): Promise<void> {
    const drafts = await data.listDrafts()
    const committed: { ref: EntryRef; content: string }[] = []
    for (const p of await git.list('content/')) {
      const ref = parseContentPath(p)
      if (ref === null) continue
      const content = await git.readFile(p)
      if (content !== null) committed.push({ ref, content })
    }
    const rows = listContentEntries({ drafts, committed, deployedAt }).map(projectRow)
    await index.clear()
    await index.upsertMany(rows)
    await index.setMeta({ indexedSha: await git.headSha(), version: INDEX_VERSION })
  }

  async function ensureBuilt(): Promise<void> {
    const meta = await index.getMeta()
    // Gate on version only: indexedSha is null for an empty git repo (the default
    // local start state), so also gating on `indexedSha === null` would rebuild on
    // every mount forever. version (default 0 ≠ INDEX_VERSION) covers cold start.
    if (meta.version !== INDEX_VERSION) await rebuild()
  }

  async function reindexEntry(ref: EntryRef): Promise<void> {
    const draft = await data.getDraft(ref)
    const committedStr = await git.readFile(contentPath(ref))
    const drafts = draft ? [draft] : []
    const committed = committedStr !== null ? [{ ref, content: committedStr }] : []
    const rows = listContentEntries({ drafts, committed, deployedAt })
    if (rows.length === 0) await index.remove(indexKey(ref))
    else await index.upsert(projectRow(rows[0]!))
  }

  async function reindexAfterDeploy(): Promise<void> {
    await rebuild()
  }

  async function query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }> {
    const { rows, total } = await index.query(q)
    return { rows: rows.map(rowToContentRow), total }
  }

  async function distinctTags(prefix: string, limit: number): Promise<string[]> {
    return index.distinctTags(prefix, limit)
  }

  async function distinctLocales(): Promise<string[]> {
    return index.distinctLocales()
  }

  async function categoryCounts(): Promise<Record<string, number>> {
    return index.categoryCounts()
  }

  async function referencedBy(mediaKey: string): Promise<import('./referenced-by').MediaUsage[]> {
    return index.referencedBy(mediaKey)
  }

  return { rebuild, ensureBuilt, reindexEntry, reindexAfterDeploy, query, distinctTags, distinctLocales, categoryCounts, referencedBy }
}
