import { describe, expect, it } from 'vitest'
import { runQuery } from './run-query'
import type { EntryIndexRow } from './types'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`, collection: 'post', locale: 'en',
  slug: 'x', title: 'X', titleLower: 'x', status: 'draft', updatedAt: 0,
  hasDraft: true, tags: [], categories: [], mediaRefs: [], ...over,
})

describe('runQuery — tag & category filters', () => {
  const rows = [
    row({ slug: 'a', title: 'A', tags: ['react'], categories: ['guides'], status: 'draft' }),
    row({ slug: 'b', title: 'B', tags: ['vue'], categories: ['guides'], status: 'live' }),
    row({ slug: 'c', title: 'C', tags: ['react'], categories: ['news'], status: 'draft' }),
  ]
  const base = { collection: 'post', offset: 0, limit: 10 }

  it('filters by tag', () => {
    const r = runQuery(rows, { ...base, tag: 'react' })
    expect(r.rows.map((x) => x.slug).sort()).toEqual(['a', 'c'])
  })
  it('filters by category', () => {
    const r = runQuery(rows, { ...base, category: 'guides' })
    expect(r.rows.map((x) => x.slug).sort()).toEqual(['a', 'b'])
  })
  it('combines tag + category + status with AND', () => {
    const r = runQuery(rows, { ...base, tag: 'react', category: 'guides', status: 'draft' })
    expect(r.rows.map((x) => x.slug)).toEqual(['a'])
  })
  it('no tag/category filter returns all in the collection', () => {
    expect(runQuery(rows, base).total).toBe(3)
  })
})
