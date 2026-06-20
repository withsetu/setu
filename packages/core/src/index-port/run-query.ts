import type { EntryIndexRow, IndexQuery, SortKey } from './types'

function compare(a: EntryIndexRow, b: EntryIndexRow, key: SortKey): number {
  if (key === 'title') return a.titleLower.localeCompare(b.titleLower)
  if (key === 'status') return a.status.localeCompare(b.status)
  // updatedAt: null → -Infinity so that when direction is negated (desc), nulls land last
  const av = a.updatedAt ?? -Infinity
  const bv = b.updatedAt ?? -Infinity
  return av - bv
}

export function runQuery(
  rows: EntryIndexRow[],
  q: IndexQuery,
): { rows: EntryIndexRow[]; total: number } {
  let xs = rows.filter((r) => r.collection === q.collection)
  if (q.locale) xs = xs.filter((r) => r.locale === q.locale)
  if (q.status) xs = xs.filter((r) => r.status === q.status)
  if (q.q && q.q.length > 0) {
    const needle = q.q.toLowerCase()
    xs = xs.filter((r) => r.titleLower.includes(needle) || r.slug.toLowerCase().includes(needle))
  }
  if (q.tag) xs = xs.filter((r) => r.tags.includes(q.tag!))
  if (q.category) xs = xs.filter((r) => r.categories.includes(q.category!))
  const sort = q.sort ?? { key: 'updatedAt' as SortKey, dir: 'desc' as const }
  const sorted = [...xs].sort((a, b) => {
    const c = compare(a, b, sort.key)
    return sort.dir === 'asc' ? c : -c
  })
  const total = sorted.length
  return { rows: sorted.slice(q.offset, q.offset + q.limit), total }
}
