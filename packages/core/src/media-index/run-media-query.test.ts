import { describe, it, expect } from 'vitest'
import { runMediaQuery } from './run-media-query'
import type { MediaIndexRow } from './types'

const row = (o: Partial<MediaIndexRow>): MediaIndexRow => ({
  mediaKey: o.mediaKey ?? 'k',
  key: o.key ?? 'k.jpg',
  thumbKey: o.thumbKey ?? null,
  filename: o.filename ?? 'f.jpg',
  filenameLower: (o.filename ?? 'f.jpg').toLowerCase(),
  contentType: o.contentType ?? 'image/jpeg',
  isImage: o.isImage ?? true,
  width: o.width ?? null,
  height: o.height ?? null,
  bytes: o.bytes ?? 0,
  uploadedAt: o.uploadedAt ?? 0
})

describe('runMediaQuery', () => {
  it('defaults to uploadedAt desc and paginates with total', () => {
    const rows = [
      row({ mediaKey: 'a', uploadedAt: 1 }),
      row({ mediaKey: 'b', uploadedAt: 3 }),
      row({ mediaKey: 'c', uploadedAt: 2 })
    ]
    const r = runMediaQuery(rows, { offset: 0, limit: 2 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.mediaKey)).toEqual(['b', 'c'])
  })
  it('filters by media kind (image vs document), derived from contentType', () => {
    const rows = [
      row({ mediaKey: 'img', contentType: 'image/png' }),
      row({ mediaKey: 'pdf', contentType: 'application/pdf' }),
      row({ mediaKey: 'mp3', contentType: 'audio/mpeg' })
    ]
    expect(
      runMediaQuery(rows, { type: 'image', offset: 0, limit: 10 }).rows.map(
        (x) => x.mediaKey
      )
    ).toEqual(['img'])
    expect(
      runMediaQuery(rows, { type: 'document', offset: 0, limit: 10 }).rows.map(
        (x) => x.mediaKey
      )
    ).toEqual(['pdf'])
    expect(
      runMediaQuery(rows, { type: 'all', offset: 0, limit: 10 }).total
    ).toBe(3)
  })
  it('filters by filename substring (case-insensitive)', () => {
    const rows = [
      row({ mediaKey: 'a', filename: 'Sunset.jpg' }),
      row({ mediaKey: 'b', filename: 'cat.png' })
    ]
    expect(
      runMediaQuery(rows, { q: 'SUN', offset: 0, limit: 10 }).rows.map(
        (x) => x.mediaKey
      )
    ).toEqual(['a'])
  })
  it('sorts by filename asc and bytes desc', () => {
    const rows = [
      row({ mediaKey: 'a', filename: 'b.jpg', bytes: 10 }),
      row({ mediaKey: 'b', filename: 'a.jpg', bytes: 30 })
    ]
    expect(
      runMediaQuery(rows, {
        sort: { key: 'filename', dir: 'asc' },
        offset: 0,
        limit: 10
      }).rows.map((x) => x.mediaKey)
    ).toEqual(['b', 'a'])
    expect(
      runMediaQuery(rows, {
        sort: { key: 'bytes', dir: 'desc' },
        offset: 0,
        limit: 10
      }).rows.map((x) => x.mediaKey)
    ).toEqual(['b', 'a'])
  })
})

describe('runMediaQuery tie-breaking', () => {
  // #911: the adapter contract's tie cases (packages/db-testing/src/index.ts)
  // cannot fail on db-idb — IndexedDB `getAll` already hands rows back in
  // ascending key order and the store key IS `mediaKey`, so "tiebreak applied"
  // and "storage order" look identical there. This layer owns the tiebreak, and
  // here it is asserted against input arrays that deliberately disagree with the
  // expected output, so no storage order can stand in for it.
  const permutations = <T>(xs: T[]): T[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) =>
          permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [
            x,
            ...rest
          ])
        )

  it('orders tied rows by ascending mediaKey from any input order', () => {
    const tied = [
      row({ mediaKey: 'zeta', uploadedAt: 5 }),
      row({ mediaKey: 'alpha', uploadedAt: 5 }),
      row({ mediaKey: 'mid', uploadedAt: 5 })
    ]
    for (const perm of permutations(tied))
      expect(
        runMediaQuery(perm, { offset: 0, limit: 10 }).rows.map(
          (x) => x.mediaKey
        )
      ).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('keeps the mediaKey tiebreak ascending under a descending sort', () => {
    // The tiebreak is applied AFTER the direction negation, so reversing the
    // sort must not reverse it — otherwise page 1 and page 2 stop partitioning
    // the set on a remove+re-add (what an incremental reindex does).
    const tied = [
      row({ mediaKey: 'zeta', uploadedAt: 5 }),
      row({ mediaKey: 'alpha', uploadedAt: 5 })
    ]
    for (const dir of ['asc', 'desc'] as const)
      for (const perm of permutations(tied))
        expect(
          runMediaQuery(perm, {
            offset: 0,
            limit: 10,
            sort: { key: 'uploadedAt', dir }
          }).rows.map((x) => x.mediaKey)
        ).toEqual(['alpha', 'zeta'])
  })

  it('breaks filename and bytes ties on mediaKey too, in both directions', () => {
    const tied = [
      row({ mediaKey: '2026/07/dup', filename: 'dup.jpg', bytes: 10 }),
      row({ mediaKey: '2026/06/dup', filename: 'dup.jpg', bytes: 10 })
    ]
    for (const key of ['filename', 'bytes'] as const)
      for (const dir of ['asc', 'desc'] as const)
        for (const perm of permutations(tied))
          expect(
            runMediaQuery(perm, {
              offset: 0,
              limit: 10,
              sort: { key, dir }
            }).rows.map((x) => x.mediaKey)
          ).toEqual(['2026/06/dup', '2026/07/dup'])
  })

  it('pages a tied run without repeating or dropping a row', () => {
    const tied = [
      row({ mediaKey: 'd', uploadedAt: 5 }),
      row({ mediaKey: 'b', uploadedAt: 5 }),
      row({ mediaKey: 'a', uploadedAt: 5 }),
      row({ mediaKey: 'c', uploadedAt: 5 })
    ]
    const page = (rows: MediaIndexRow[], offset: number): string[] =>
      runMediaQuery(rows, { offset, limit: 2 }).rows.map((x) => x.mediaKey)
    // Page 2 is fetched after the store reordered underneath (a remove+upsert
    // moves a row to the end of sqlite rowid / Map insertion order).
    const reordered = [tied[1]!, tied[2]!, tied[3]!, tied[0]!]
    expect([...page(tied, 0), ...page(reordered, 2)]).toEqual([
      'a',
      'b',
      'c',
      'd'
    ])
  })

  it('breaks ties by collation, not by UTF-16 code unit', () => {
    // The seam the adapter contract exploits to become falsifiable on db-idb:
    // IndexedDB key order is code-unit ('B' < 'a'), localeCompare is not.
    expect(
      runMediaQuery(
        [
          row({ mediaKey: 'Beta', uploadedAt: 5 }),
          row({ mediaKey: 'alpha', uploadedAt: 5 })
        ],
        { offset: 0, limit: 10 }
      ).rows.map((x) => x.mediaKey)
    ).toEqual(['alpha', 'Beta'])
  })
})
