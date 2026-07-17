import type { LifecycleState } from '../lifecycle/derive'
import type { EntryIndexRow } from './types'

/** Per-collection lifecycle tallies: `total` plus one counter per
 *  {@link LifecycleState}. */
export interface CollectionStats extends Record<LifecycleState, number> {
  total: number
}

/** Per-collection lifecycle tallies over body-free index rows, keyed by
 *  collection. The dashboard's At-a-glance counts (Posts / Pages / Published /
 *  Drafts) — and any future per-collection status breakdown — read this in a
 *  SINGLE pass, with no bodies fetched and no N round-trips (#587). Collections
 *  with zero rows are absent. */
export type IndexStats = Record<string, CollectionStats>

const zero = (): CollectionStats => ({
  total: 0,
  draft: 0,
  staged: 0,
  live: 0,
  unpublished: 0
})

/** One-pass tally used by every IndexPort adapter (cf. selectCategoryCounts).
 *  A future SQL `COUNT`/`GROUP BY` implementation (#588/#205) can replace the
 *  adapter-side scan while keeping this exact shape. */
export function selectIndexStats(rows: EntryIndexRow[]): IndexStats {
  const out: IndexStats = {}
  for (const r of rows) {
    const c = (out[r.collection] ??= zero())
    c.total += 1
    c[r.status] += 1
  }
  return out
}
