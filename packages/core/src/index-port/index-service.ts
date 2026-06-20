import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { EntryRef } from '../data/types'
import type { ContentRow } from '../content-index/list-entries'
import { listContentEntries } from '../content-index/list-entries'
import { parseContentPath } from '../publish/content-path'
import type { IndexPort, IndexQuery } from './types'
import { projectRow, rowToContentRow } from './types'

export const INDEX_VERSION = 1

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
    if (meta.version !== INDEX_VERSION) await rebuild()
  }

  // reindexEntry + reindexAfterDeploy are added in Task 7.
  async function reindexEntry(_ref: EntryRef): Promise<void> {
    throw new Error('not implemented')
  }
  async function reindexAfterDeploy(): Promise<void> {
    throw new Error('not implemented')
  }

  async function query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }> {
    const { rows, total } = await index.query(q)
    return { rows: rows.map(rowToContentRow), total }
  }

  return { rebuild, ensureBuilt, reindexEntry, reindexAfterDeploy, query }
}
