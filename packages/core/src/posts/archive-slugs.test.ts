import { describe, expect, it } from 'vitest'
import {
  distinctCategorySlugs,
  distinctTagSlugs,
  categoryNameMap
} from './archive-slugs'
import type { PostRow } from './select-posts'

const row = (slug: string, extra: Partial<PostRow> = {}): PostRow => ({
  id: `post/en/${slug}`,
  collection: 'post',
  locale: 'en',
  slug,
  title: slug.toUpperCase(),
  date: null,
  tags: [],
  categories: [],
  ...extra
})

describe('distinctCategorySlugs / distinctTagSlugs', () => {
  it('dedupes and sorts slugs from posts in the locale', () => {
    const rows = [
      row('a', { categories: ['news', 'guides'], tags: ['x'] }),
      row('b', { categories: ['news'], tags: ['y', 'x'] })
    ]
    expect(distinctCategorySlugs(rows, 'en')).toEqual(['guides', 'news'])
    expect(distinctTagSlugs(rows, 'en')).toEqual(['x', 'y'])
  })

  // #580 — taxonomy archives aggregate ONLY posts: a categorized/tagged PAGE
  // (hand-authored frontmatter) must not mint /category/x or /tag/x paths.
  it('excludes non-post collections even when they carry categories/tags', () => {
    const rows = [
      row('a', { categories: ['news'], tags: ['x'] }),
      {
        ...row('about', { categories: ['page-cat'], tags: ['page-tag'] }),
        id: 'page/en/about',
        collection: 'page'
      }
    ]
    expect(distinctCategorySlugs(rows, 'en')).toEqual(['news'])
    expect(distinctTagSlugs(rows, 'en')).toEqual(['x'])
  })

  it('excludes other locales and skips empty values', () => {
    const rows = [
      row('a', { categories: ['news', ''], tags: ['x', ''] }),
      { ...row('b'), id: 'post/fr/b', locale: 'fr', categories: ['fr-only'] }
    ]
    expect(distinctCategorySlugs(rows, 'en')).toEqual(['news'])
    expect(distinctTagSlugs(rows, 'en')).toEqual(['x'])
  })
})

describe('categoryNameMap', () => {
  it('maps slug to display name', () => {
    const map = categoryNameMap([
      { slug: 'news', name: 'News', parent: null },
      { slug: 'guides', name: 'How-to Guides', parent: null }
    ])
    expect(map.get('guides')).toBe('How-to Guides')
    expect(map.get('missing')).toBeUndefined()
  })
})
