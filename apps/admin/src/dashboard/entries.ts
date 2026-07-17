import type {
  CollectionStats,
  ContentRow,
  IndexService,
  IndexStats
} from '@setu/core'

/** The four At-a-glance dashboard tiles. */
export interface DashboardCounts {
  posts: number
  pages: number
  published: number
  drafts: number
}

/** Collections the At-a-glance tiles summarize (Posts / Pages). */
const DASHBOARD_COLLECTIONS = ['post', 'page'] as const

const ZERO: CollectionStats = {
  total: 0,
  draft: 0,
  staged: 0,
  live: 0,
  unpublished: 0
}

/** Derive the four tile numbers from the index's one-call per-collection
 *  lifecycle tallies (#587). Semantics match the pre-#587 client tally exactly
 *  (proven in dashboard-entries.test.ts): Posts/Pages = all entries of that
 *  collection; Published = staged + live; Drafts = draft — 'unpublished'
 *  counts toward neither, and only the post + page collections are summed. */
export function dashboardCountsFromStats(stats: IndexStats): DashboardCounts {
  const post = stats['post'] ?? ZERO
  const page = stats['page'] ?? ZERO
  let published = 0
  let drafts = 0
  for (const collection of DASHBOARD_COLLECTIONS) {
    const c = stats[collection] ?? ZERO
    published += c.staged + c.live
    drafts += c.draft
  }
  return { posts: post.total, pages: page.total, published, drafts }
}

/** The few most-recently-edited entries for the "Resume editing" widget —
 *  index-backed and body-free (#587). Each collection is queried sorted by
 *  updatedAt desc, `limit`-capped server-side; the small pages are merged and
 *  re-capped so the widget shows the newest across post + page (matching the
 *  pre-#587 merged-and-sorted behavior) without ever materializing all N. */
export async function loadRecentEntries(
  index: Pick<IndexService, 'query'>,
  limit: number,
  collections: readonly string[] = DASHBOARD_COLLECTIONS
): Promise<ContentRow[]> {
  const pages = await Promise.all(
    collections.map((collection) =>
      index.query({
        collection,
        offset: 0,
        limit,
        sort: { key: 'updatedAt', dir: 'desc' }
      })
    )
  )
  return pages
    .flatMap((p) => p.rows)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit)
}
