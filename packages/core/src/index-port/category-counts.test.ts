import { describe, expect, it } from 'vitest'
import { selectCategoryCounts } from './category-counts'
import type { EntryIndexRow } from './types'

const row = (key: string, categories: string[]): EntryIndexRow => ({
  key,
  collection: 'post',
  locale: 'en',
  slug: key,
  title: key,
  titleLower: key,
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  tags: [],
  categories,
  mediaRefs: []
})

describe('selectCategoryCounts', () => {
  it('counts entries per category slug across rows', () => {
    const counts = selectCategoryCounts([
      row('a', ['eng', 'news']),
      row('b', ['eng']),
      row('c', [])
    ])
    expect(counts).toEqual({ eng: 2, news: 1 })
  })
  it('returns an empty map when no row has categories', () => {
    expect(selectCategoryCounts([row('a', []), row('b', [])])).toEqual({})
  })
})
