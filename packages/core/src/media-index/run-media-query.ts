import type { MediaIndexRow, MediaIndexQuery, MediaSortKey } from './types'
import { mediaKind } from './media-kind'

function compare(a: MediaIndexRow, b: MediaIndexRow, key: MediaSortKey): number {
  if (key === 'filename') return a.filenameLower.localeCompare(b.filenameLower)
  if (key === 'bytes') return a.bytes - b.bytes
  return a.uploadedAt - b.uploadedAt
}

export function runMediaQuery(
  rows: MediaIndexRow[],
  q: MediaIndexQuery,
): { rows: MediaIndexRow[]; total: number } {
  let xs = rows
  if (q.type && q.type !== 'all') xs = xs.filter((r) => mediaKind(r.contentType) === q.type)
  if (q.q && q.q.length > 0) {
    const needle = q.q.toLowerCase()
    xs = xs.filter((r) => r.filenameLower.includes(needle))
  }
  const sort = q.sort ?? { key: 'uploadedAt' as MediaSortKey, dir: 'desc' as const }
  const sorted = [...xs].sort((a, b) => {
    const c = compare(a, b, sort.key)
    return sort.dir === 'asc' ? c : -c
  })
  return { rows: sorted.slice(q.offset, q.offset + q.limit), total: sorted.length }
}
