import { describe, expect, it } from 'vitest'
import { runQuery } from './run-query'
import type { EntryIndexRow } from './types'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`,
  collection: 'post',
  locale: 'en',
  slug: 'x',
  title: 'X',
  titleLower: 'x',
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  hasFeaturedImage: false,
  ...over
})

describe('runQuery — tag & category filters', () => {
  const rows = [
    row({
      slug: 'a',
      title: 'A',
      tags: ['react'],
      categories: ['guides'],
      status: 'draft'
    }),
    row({
      slug: 'b',
      title: 'B',
      tags: ['vue'],
      categories: ['guides'],
      status: 'live'
    }),
    row({
      slug: 'c',
      title: 'C',
      tags: ['react'],
      categories: ['news'],
      status: 'draft'
    })
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
    const r = runQuery(rows, {
      ...base,
      tag: 'react',
      category: 'guides',
      status: 'draft'
    })
    expect(r.rows.map((x) => x.slug)).toEqual(['a'])
  })
  it('no tag/category filter returns all in the collection', () => {
    expect(runQuery(rows, base).total).toBe(3)
  })
})

describe('runQuery — featured-image filter (#576)', () => {
  const rows = [
    row({ slug: 'with', hasFeaturedImage: true }),
    row({ slug: 'without', hasFeaturedImage: false })
  ]
  const base = { collection: 'post', offset: 0, limit: 10 }

  it('hasFeaturedImage: true keeps only rows with a featured image', () => {
    const r = runQuery(rows, { ...base, hasFeaturedImage: true })
    expect(r.rows.map((x) => x.slug)).toEqual(['with'])
    expect(r.total).toBe(1)
  })
  it('hasFeaturedImage: false keeps only rows without one', () => {
    const r = runQuery(rows, { ...base, hasFeaturedImage: false })
    expect(r.rows.map((x) => x.slug)).toEqual(['without'])
  })
  it('omitting the filter returns both', () => {
    expect(runQuery(rows, base).total).toBe(2)
  })
})
