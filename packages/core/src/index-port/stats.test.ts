import { describe, it, expect } from 'vitest'
import type { EntryIndexRow } from './types'
import { selectIndexStats } from './stats'
import type { LifecycleState } from '../lifecycle/derive'

const row = (
  collection: string,
  status: LifecycleState,
  slug: string
): EntryIndexRow => ({
  key: `${collection}\0en\0${slug}`,
  collection,
  locale: 'en',
  slug,
  title: slug,
  titleLower: slug,
  status,
  updatedAt: 0,
  hasDraft: false,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false
})

describe('selectIndexStats', () => {
  it('empty index → no collections', () => {
    expect(selectIndexStats([])).toEqual({})
  })

  it('tallies total and per-status counts, one pass, across collections', () => {
    const stats = selectIndexStats([
      row('post', 'live', 'a'),
      row('post', 'live', 'b'),
      row('post', 'staged', 'c'),
      row('post', 'draft', 'd'),
      row('post', 'unpublished', 'e'),
      row('page', 'live', 'about'),
      row('page', 'draft', 'contact')
    ])
    expect(stats).toEqual({
      post: { total: 5, draft: 1, staged: 1, live: 2, unpublished: 1 },
      page: { total: 2, draft: 1, staged: 0, live: 1, unpublished: 0 }
    })
  })

  it('a collection absent from the index is simply missing (not zeroed)', () => {
    const stats = selectIndexStats([row('post', 'draft', 'a')])
    expect(stats['post']).toEqual({
      total: 1,
      draft: 1,
      staged: 0,
      live: 0,
      unpublished: 0
    })
    expect(stats['page']).toBeUndefined()
  })
})
