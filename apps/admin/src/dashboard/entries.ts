import type { ContentRow, DataPort, EntryRef, GitPort, Lock } from '@setu/core'
import { listContentEntries, parseContentPath } from '@setu/core'

const DEFAULT_COLLECTIONS = ['post', 'page']

export async function loadDashboardEntries(
  data: DataPort,
  git: GitPort,
  deployedAt: (path: string) => string | null,
  collections: string[] = DEFAULT_COLLECTIONS
): Promise<ContentRow[]> {
  const all: ContentRow[] = []
  for (const collection of collections) {
    const drafts = await data.listDrafts({ collection })
    const committed: { ref: EntryRef; content: string }[] = []
    for (const p of await git.list(`content/${collection}/`)) {
      const ref = parseContentPath(p)
      if (ref === null) continue
      const content = await git.readFile(p)
      if (content !== null) committed.push({ ref, content })
    }
    all.push(...listContentEntries({ drafts, committed, deployedAt }))
  }
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function dashboardCounts(rows: ContentRow[]): {
  posts: number
  pages: number
  drafts: number
  published: number
} {
  let posts = 0,
    pages = 0,
    drafts = 0,
    published = 0
  for (const r of rows) {
    if (r.ref.collection === 'post') posts++
    else if (r.ref.collection === 'page') pages++
    if (r.lifecycle.state === 'draft') drafts++
    else if (r.lifecycle.state === 'staged' || r.lifecycle.state === 'live')
      published++
  }
  return { posts, pages, drafts, published }
}

export function recentEntries(rows: ContentRow[], limit: number): ContentRow[] {
  return rows.slice(0, limit)
}

export async function loadActiveLocks(
  data: DataPort,
  rows: ContentRow[]
): Promise<Lock[]> {
  const locks: Lock[] = []
  for (const r of rows) {
    const lock = await data.getLock(r.ref)
    if (lock !== null) locks.push(lock)
  }
  return locks
}
