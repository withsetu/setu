import { describe, expect, it } from 'vitest'
import { selectDistinctLocales } from './distinct-tags'
import type { EntryIndexRow } from './types'

const row = (locale: string, slug: string): EntryIndexRow => ({
  key: `post\0${locale}\0${slug}`,
  collection: 'post',
  locale,
  slug,
  title: slug,
  titleLower: slug,
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: []
})

describe('selectDistinctLocales', () => {
  it('returns distinct locales sorted ascending', () => {
    expect(
      selectDistinctLocales([row('fr', 'a'), row('en', 'b'), row('en', 'c')])
    ).toEqual(['en', 'fr'])
  })
  it('returns [] for no rows', () => {
    expect(selectDistinctLocales([])).toEqual([])
  })
})
