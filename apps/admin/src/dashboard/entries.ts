import type {
  CollectionStats,
  ContentRow,
  IndexService,
  IndexStats,
  Lock
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
 *  counts toward neither, and only the post + page collections are summed.
 *
 *  DELIBERATE, owner-approved (2026-07-17): dashboard counts = committed / site
 *  truth. Local uncommitted browser drafts (autosave scratch) are intentionally
 *  NOT counted here — they still surface in "Resume editing" (personal recent
 *  work), just not in the At-a-glance totals. WordPress-aligned: autosave never
 *  bumps the Drafts count; a real Save Draft does — and Setu's Save Draft
 *  commits to git, so it still counts. (Pinned by an http-index-service test:
 *  a local-only draft shows in the query but not in stats().) */
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

/** updatedAt desc, then a deterministic key tie-break (slug, then collection) so
 *  a merged post+page ordering is stable and equal-updatedAt ties resolve the
 *  same way every render — never storage/merge-order dependent. null updatedAt
 *  sorts last (same as runQuery's -Infinity). */
function byRecencyThenKey(a: ContentRow, b: ContentRow): number {
  const av = a.updatedAt ?? -Infinity
  const bv = b.updatedAt ?? -Infinity
  if (bv !== av) return bv - av
  if (a.ref.slug !== b.ref.slug) return a.ref.slug < b.ref.slug ? -1 : 1
  return a.ref.collection < b.ref.collection ? -1 : 1
}

/** The few most-recently-edited entries for the "Resume editing" widget —
 *  index-backed and body-free (#587). Each collection is queried sorted by
 *  updatedAt desc, `limit`-capped server-side; the small pages are merged and
 *  re-capped so the widget shows the newest across post + page (matching the
 *  pre-#587 merged-and-sorted behavior) without ever materializing all N. The
 *  merge sort carries a deterministic tie-break so equal-updatedAt entries order
 *  identically to a single combined sort. */
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
    .sort(byRecencyThenKey)
    .slice(0, limit)
}

/** Order held locks for the "Who's editing" widget by recency — most recently
 *  acquired first (`lockedAt` desc), tie-broken by slug for determinism. #587
 *  moved lock loading from a per-entry loop (which happened to yield the
 *  entries' updatedAt order) to one `data.listLocks()` call, which returns
 *  storage order; this restores a deterministic recency order. `lockedAt` is the
 *  lock's own recency signal (when editing began) and is self-contained — locks
 *  aren't restricted to the shown recent entries, so joining to entry updatedAt
 *  would need an O(active-locks) lookup for no better signal. Pure sort over the
 *  small held-lock set. */
export function orderLocksByRecency(locks: Lock[]): Lock[] {
  return [...locks].sort((a, b) => {
    if (b.lockedAt !== a.lockedAt) return b.lockedAt - a.lockedAt
    if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1
    return a.collection < b.collection ? -1 : 1
  })
}
