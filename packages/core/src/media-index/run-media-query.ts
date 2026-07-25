import type { MediaIndexRow, MediaIndexQuery, MediaSortKey } from './types'
import { mediaKind } from './media-kind'

function compare(
  a: MediaIndexRow,
  b: MediaIndexRow,
  key: MediaSortKey
): number {
  if (key === 'filename') return a.filenameLower.localeCompare(b.filenameLower)
  if (key === 'bytes') return a.bytes - b.bytes
  return a.uploadedAt - b.uploadedAt
}

export function runMediaQuery(
  rows: MediaIndexRow[],
  q: MediaIndexQuery
): { rows: MediaIndexRow[]; total: number } {
  let xs = rows
  if (q.type && q.type !== 'all')
    xs = xs.filter((r) => mediaKind(r.contentType) === q.type)
  if (q.q && q.q.length > 0) {
    const needle = q.q.toLowerCase()
    xs = xs.filter((r) => r.filenameLower.includes(needle))
  }
  const sort = q.sort ?? {
    key: 'uploadedAt' as MediaSortKey,
    dir: 'desc' as const
  }
  // Total order (#897), the same fix runQuery carries for entries (#661): every
  // sort key here can tie — `uploadedAt` for a whole seeded library stamped from
  // one clock, `filename` for the same name in two date folders, `bytes` for two
  // files of equal size. A partial order let the result fall through to the
  // adapter's storage order (sqlite rowid / Map insertion / IDB key order), so the
  // three adapters returned different pages for identical data, and a remove+upsert
  // — what an incremental reindex does — moved the page boundary, showing one row
  // twice and hiding another. `mediaKey` is unique per row, and the tiebreak is
  // applied AFTER the direction negation so it stays ascending in both directions.
  // Enforced unconditionally by the 'runMediaQuery tie-breaking' block in
  // packages/core/src/media-index/run-media-query.test.ts, which feeds every
  // permutation of a tied run and demands one answer — no storage order can
  // stand in for the tiebreak there. Adapter parity is packages/db-testing/src/
  // index.ts; its mediaKey-ordered tie cases pass on db-idb whether or not the
  // tiebreak exists (IndexedDB `getAll` is already ascending-key), so the case
  // that does falsify all three picks keys where code-unit and collation order
  // disagree (#911).
  const sorted = [...xs].sort((a, b) => {
    const c = compare(a, b, sort.key)
    if (c !== 0) return sort.dir === 'asc' ? c : -c
    return a.mediaKey.localeCompare(b.mediaKey)
  })
  return {
    rows: sorted.slice(q.offset, q.offset + q.limit),
    total: sorted.length
  }
}
