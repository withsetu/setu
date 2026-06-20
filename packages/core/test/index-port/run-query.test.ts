import { describe, it, expect } from 'vitest'
import type { EntryIndexRow } from '../../src/index'
import { runQuery } from '../../src/index'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`, collection: 'post', locale: 'en', slug: 'x',
  title: 'X', titleLower: 'x', status: 'draft', updatedAt: 0, hasDraft: true, tags: [], categories: [], ...over,
})

const rows: EntryIndexRow[] = [
  row({ slug: 'a', title: 'Alpha', titleLower: 'alpha', updatedAt: 3, status: 'live' }),
  row({ slug: 'b', title: 'Bravo', titleLower: 'bravo', updatedAt: 1, status: 'draft' }),
  row({ slug: 'c', title: 'Charlie', titleLower: 'charlie', updatedAt: null, status: 'draft' }),
  { ...row({ slug: 'd', title: 'Delta', titleLower: 'delta' }), collection: 'page' },
]

describe('runQuery', () => {
  it('filters to the collection and sorts by updatedAt desc with nulls last', () => {
    const r = runQuery(rows, { collection: 'post', offset: 0, limit: 10 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.slug)).toEqual(['a', 'b', 'c'])
  })

  it('filters by status', () => {
    const r = runQuery(rows, { collection: 'post', status: 'draft', offset: 0, limit: 10 })
    expect(r.rows.map((x) => x.slug)).toEqual(['b', 'c'])
  })

  it('searches title and slug case-insensitively', () => {
    expect(runQuery(rows, { collection: 'post', q: 'ALP', offset: 0, limit: 10 }).rows.map((x) => x.slug)).toEqual(['a'])
    expect(runQuery(rows, { collection: 'post', q: 'b', offset: 0, limit: 10 }).rows.map((x) => x.slug).sort()).toEqual(['b'])
  })

  it('sorts by title asc and paginates with a stable total', () => {
    const r = runQuery(rows, { collection: 'post', sort: { key: 'title', dir: 'asc' }, offset: 1, limit: 1 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.slug)).toEqual(['b'])
  })
})
