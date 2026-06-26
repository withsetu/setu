import { describe, expect, it } from 'vitest'
import { selectRelatedPosts, type RelatedRow } from './related-posts'

const row = (
  slug: string,
  tags: string[],
  extra: Partial<RelatedRow> = {},
): RelatedRow => ({
  key: `post/en/${slug}`,
  collection: 'post',
  locale: 'en',
  slug,
  title: slug.toUpperCase(),
  tags,
  categories: [],
  updatedAt: 0,
  ...extra,
})

describe('selectRelatedPosts', () => {
  it('ranks by shared-tag Jaccard, excludes self, returns resolved refs', () => {
    const rows = [
      row('a', ['astro', 'cms']),
      row('b', ['astro', 'cms']), // identical → Jaccard 1
      row('c', ['astro']), //        partial   → Jaccard 0.5
      row('d', ['cooking']), //      disjoint  → excluded
    ]
    const out = selectRelatedPosts(rows, { k: 4 })
    expect(out['post/en/a']).toEqual([
      { collection: 'post', locale: 'en', slug: 'b', title: 'B' },
      { collection: 'post', locale: 'en', slug: 'c', title: 'C' },
    ])
    expect(out['post/en/a']!.some((r) => r.slug === 'a')).toBe(false)
  })

  it('scopes candidates to the same collection and locale', () => {
    const rows: RelatedRow[] = [
      row('a', ['astro']),
      row('b', ['astro'], { key: 'post/fr/b', locale: 'fr' }), // other locale
      { ...row('c', ['astro']), key: 'page/en/c', collection: 'page' }, // other collection
    ]
    expect(selectRelatedPosts(rows)['post/en/a']).toEqual([])
  })

  it('adds a category boost so a shared category outranks an equal-tag peer', () => {
    const rows = [
      row('a', ['astro'], { categories: ['guides'] }),
      row('b', ['astro'], { categories: ['guides'] }), // same tag + shared category
      row('c', ['astro'], { categories: ['news'] }), //   same tag, no shared category
    ]
    const out = selectRelatedPosts(rows, { k: 2, categoryBoost: 0.25 })
    expect(out['post/en/a']!.map((r) => r.slug)).toEqual(['b', 'c'])
  })

  it('truncates to k', () => {
    const rows = ['b', 'c', 'd', 'e', 'f'].map((s) => row(s, ['astro'])).concat(row('a', ['astro']))
    expect(selectRelatedPosts(rows, { k: 3 })['post/en/a']).toHaveLength(3)
  })

  it('breaks score ties by recency (updatedAt desc) then key', () => {
    const rows = [
      row('a', ['astro']),
      row('b', ['astro'], { updatedAt: 100 }),
      row('c', ['astro'], { updatedAt: 200 }), // newer → first
    ]
    expect(selectRelatedPosts(rows, { k: 2 })['post/en/a']!.map((r) => r.slug)).toEqual(['c', 'b'])
  })

  it('falls back to same-category, then recency, to fill empty slots', () => {
    const rows = [
      row('a', ['astro'], { categories: ['guides'], updatedAt: 0 }),
      row('cat', ['unrelated'], { categories: ['guides'], updatedAt: 5 }), // tier 1: shared category
      row('recentish', ['unrelated'], { categories: ['news'], updatedAt: 9 }), // tier 2: recency
      row('older', ['unrelated'], { categories: ['news'], updatedAt: 1 }), //     tier 2: recency
    ]
    // No tag match for 'a' → fill: category peer first, then most-recent others.
    expect(selectRelatedPosts(rows, { k: 3 })['post/en/a']!.map((r) => r.slug)).toEqual([
      'cat',
      'recentish',
      'older',
    ])
  })

  it('returns [] for a source with no other in-scope rows', () => {
    expect(selectRelatedPosts([row('a', ['astro'])])['post/en/a']).toEqual([])
  })

  it('treats null updatedAt as oldest in tiebreaks', () => {
    const rows = [
      row('a', ['astro']),
      row('b', ['astro'], { updatedAt: null }),
      row('c', ['astro'], { updatedAt: 1 }),
    ]
    expect(selectRelatedPosts(rows, { k: 2 })['post/en/a']!.map((r) => r.slug)).toEqual(['c', 'b'])
  })
})
