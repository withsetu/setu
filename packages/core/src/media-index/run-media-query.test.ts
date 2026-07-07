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
