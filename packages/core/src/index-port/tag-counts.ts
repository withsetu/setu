import type { EntryIndexRow } from './types'

/** Usage count per tag across all rows. Tags with zero usage are absent. Shared
 *  pure impl, used by every IndexPort adapter (cf. selectCategoryCounts). */
export function selectTagCounts(rows: EntryIndexRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) for (const t of r.tags) counts[t] = (counts[t] ?? 0) + 1
  return counts
}
