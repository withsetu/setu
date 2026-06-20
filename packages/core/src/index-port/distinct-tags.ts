import type { EntryIndexRow } from './types'

/** Distinct tags across rows whose value starts with the (lowercased) prefix,
 *  sorted ascending, capped at `limit`. Empty prefix → first `limit` tags. The
 *  single filter/sort impl, shared by every IndexPort adapter (cf. runQuery). */
export function selectDistinctTags(rows: EntryIndexRow[], prefix: string, limit: number): string[] {
  const p = prefix.toLowerCase().trim()
  const set = new Set<string>()
  for (const r of rows) for (const t of r.tags) if (t.startsWith(p)) set.add(t)
  return [...set].sort().slice(0, limit)
}
