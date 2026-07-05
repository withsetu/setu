import type { EntryIndexRow } from './types'

/** Usage count per category slug across all rows. Slugs with zero usage are
 *  absent. Shared pure impl, used by every IndexPort adapter (cf. selectDistinctTags). */
export function selectCategoryCounts(
  rows: EntryIndexRow[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows)
    for (const c of r.categories) counts[c] = (counts[c] ?? 0) + 1
  return counts
}
