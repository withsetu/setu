import { describe, expect, it } from 'vitest'
import { selectEntriesByTag } from './entries-by-tag'
import type { EntryIndexRow } from './types'

const row = (
  collection: string,
  slug: string,
  tags: string[]
): EntryIndexRow => ({
  key: `${collection}/${slug}`,
  collection,
  locale: 'en',
  slug,
  title: slug,
  titleLower: slug,
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  date: null,
  tags,
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 }
})

describe('selectEntriesByTag', () => {
  it('returns refs across collections that include the tag', () => {
    expect(
      selectEntriesByTag(
        [
          row('post', 'a', ['react']),
          row('page', 'b', ['react', 'css']),
          row('post', 'c', ['css'])
        ],
        'react'
      )
    ).toEqual([
      { collection: 'post', locale: 'en', slug: 'a' },
      { collection: 'page', locale: 'en', slug: 'b' }
    ])
  })
  it('returns [] when no entry uses the tag', () => {
    expect(selectEntriesByTag([row('post', 'a', ['x'])], 'react')).toEqual([])
  })
})
