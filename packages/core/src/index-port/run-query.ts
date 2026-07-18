import type { EntryIndexRow, IndexQuery, SortKey } from './types'
import { matchesStatusFilter } from './types'

function compare(a: EntryIndexRow, b: EntryIndexRow, key: SortKey): number {
  if (key === 'title') return a.titleLower.localeCompare(b.titleLower)
  if (key === 'status') return a.status.localeCompare(b.status)
  if (key === 'locale') return a.locale.localeCompare(b.locale)
  // updatedAt: null → -Infinity so that when direction is negated (desc), nulls land last
  const av = a.updatedAt ?? -Infinity
  const bv = b.updatedAt ?? -Infinity
  return av - bv
}

export function runQuery(
  rows: EntryIndexRow[],
  q: IndexQuery
): { rows: EntryIndexRow[]; total: number } {
  // No `collection` = the cross-collection scope, every collection at once
  // (#604) — what the dashboard's post+page status tiles link to.
  let xs =
    q.collection === undefined
      ? rows
      : rows.filter((r) => r.collection === q.collection)
  if (q.locale) xs = xs.filter((r) => r.locale === q.locale)
  // 'published' (staged+live, #579) and 'not-published' (draft+unpublished,
  // #611) are unions; every other value is an exact lifecycle match. Expansion
  // lives in matchesStatusFilter so adapters agree.
  if (q.status) xs = xs.filter((r) => matchesStatusFilter(r.status, q.status!))
  if (q.q && q.q.length > 0) {
    const needle = q.q.toLowerCase()
    xs = xs.filter(
      (r) =>
        r.titleLower.includes(needle) || r.slug.toLowerCase().includes(needle)
    )
  }
  if (q.tag) xs = xs.filter((r) => r.tags.includes(q.tag!))
  if (q.category) xs = xs.filter((r) => r.categories.includes(q.category!))
  // === true (not truthiness): rows read back from an older persisted index may lack the
  // field until the INDEX_VERSION rebuild lands — treat those as "no featured image".
  if (q.hasFeaturedImage !== undefined)
    xs = xs.filter((r) => (r.hasFeaturedImage === true) === q.hasFeaturedImage)
  if (q.hasSeoOverrides !== undefined)
    xs = xs.filter((r) => (r.hasSeoOverrides === true) === q.hasSeoOverrides)
  const sort = q.sort ?? { key: 'updatedAt' as SortKey, dir: 'desc' as const }
  const sorted = [...xs].sort((a, b) => {
    const c = compare(a, b, sort.key)
    return sort.dir === 'asc' ? c : -c
  })
  const total = sorted.length
  return { rows: sorted.slice(q.offset, q.offset + q.limit), total }
}
