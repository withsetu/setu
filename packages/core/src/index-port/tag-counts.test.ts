import { describe, expect, it } from 'vitest'
import { selectTagCounts } from './tag-counts'
import type { EntryIndexRow } from './types'

const row = (key: string, tags: string[]): EntryIndexRow => ({
  key,
  collection: 'post',
  locale: 'en',
  slug: key,
  title: key,
  titleLower: key,
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  date: null,
  tags,
  categories: [],
  mediaRefs: [],
  hasFeaturedImage: false
})

describe('selectTagCounts', () => {
  it('counts entries per tag across rows', () => {
    expect(
      selectTagCounts([
        row('a', ['react', 'css']),
        row('b', ['react']),
        row('c', [])
      ])
    ).toEqual({ react: 2, css: 1 })
  })
  it('returns an empty map when no row has tags', () => {
    expect(selectTagCounts([row('a', []), row('b', [])])).toEqual({})
  })
})
