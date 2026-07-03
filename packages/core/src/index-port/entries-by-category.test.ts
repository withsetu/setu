import { describe, expect, it } from 'vitest'
import { selectEntriesByCategory } from './entries-by-category'
import type { EntryIndexRow } from './types'

const row = (
  collection: string,
  slug: string,
  categories: string[]
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
  tags: [],
  categories,
  mediaRefs: []
})

describe('selectEntriesByCategory', () => {
  it('returns refs across collections that include the slug', () => {
    const refs = selectEntriesByCategory(
      [
        row('post', 'a', ['eng']),
        row('page', 'b', ['eng', 'news']),
        row('post', 'c', ['news'])
      ],
      'eng'
    )
    expect(refs).toEqual([
      { collection: 'post', locale: 'en', slug: 'a' },
      { collection: 'page', locale: 'en', slug: 'b' }
    ])
  })
  it('returns [] when no entry uses the slug', () => {
    expect(selectEntriesByCategory([row('post', 'a', ['x'])], 'eng')).toEqual(
      []
    )
  })
})
