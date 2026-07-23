import { describe, expect, it } from 'vitest'
import {
  selectPosts,
  distinctCategorySlugs,
  distinctTagSlugs,
  DEFAULT_LOCALE,
  type PostRow
} from '@setu/core'
import { feedLocales } from '../src/lib/feed'
import {
  bucketPostsByTerm,
  memoFeedLocales,
  memoEntryIndex
} from '../src/lib/build-cache'

// #858: the category/tag getStaticPaths now buckets posts in one pass instead of a full
// filter+sort per distinct slug. These tests are the equivalence proof that the emitted path
// set/order AND each page's post list are byte-identical to the old per-slug `selectPosts`.

const L = DEFAULT_LOCALE
const row = (over: Partial<PostRow>): PostRow => ({
  id: over.id ?? `post/${L}/${over.slug ?? 't'}`,
  collection: 'post',
  locale: L,
  slug: over.slug ?? 't',
  title: over.title ?? over.slug ?? 't',
  date: over.date ?? null,
  tags: over.tags ?? [],
  categories: over.categories ?? [],
  ...over
})

// A fixture that exercises every equivalence-critical branch: multiple terms per post, a post that
// repeats a term (Array.includes yields it once → bucket must too), an empty term (skipped like
// distinct*Slugs), null vs real dates (null sorts last), published:false (filtered), a non-post
// collection and a non-default locale (both filtered by selectPosts).
const rows: PostRow[] = [
  row({ slug: 'a', date: 300, categories: ['news', 'recipes'], tags: ['x'] }),
  row({
    slug: 'b',
    date: 100,
    categories: ['recipes', 'recipes', ''],
    tags: ['x', 'y']
  }),
  row({ slug: 'c', date: 200, categories: ['news'], tags: ['y'] }),
  row({ slug: 'd', date: null, categories: ['recipes'], tags: ['z'] }),
  row({
    slug: 'e',
    date: 400,
    categories: ['recipes'],
    tags: ['x'],
    published: false
  }),
  row({
    id: 'page/en/p',
    slug: 'p',
    collection: 'page',
    date: 500,
    categories: ['news'],
    tags: ['x']
  }),
  row({
    id: 'post/fr/f',
    slug: 'f',
    locale: 'fr',
    date: 600,
    categories: ['news'],
    tags: ['x']
  })
]

const published = selectPosts(rows, {
  collection: 'post',
  locale: L,
  sort: 'newest',
  limit: rows.length,
  offset: 0
})

describe('bucketPostsByTerm is byte-identical to per-slug selectPosts', () => {
  it('categories: key order matches distinctCategorySlugs and each bucket matches selectPosts', () => {
    const buckets = bucketPostsByTerm(published, (p) => p.categories)
    const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b))
    expect(keys).toEqual(distinctCategorySlugs(published, L))
    for (const slug of keys) {
      expect(buckets.get(slug)).toEqual(
        selectPosts(rows, {
          collection: 'post',
          locale: L,
          category: slug,
          sort: 'newest',
          limit: rows.length,
          offset: 0
        })
      )
    }
    // and no phantom bucket for the empty-string category or the filtered-out rows
    expect(buckets.has('')).toBe(false)
  })

  it('tags: key order matches distinctTagSlugs and each bucket matches selectPosts', () => {
    const buckets = bucketPostsByTerm(published, (p) => p.tags)
    const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b))
    expect(keys).toEqual(distinctTagSlugs(published, L))
    for (const slug of keys) {
      expect(buckets.get(slug)).toEqual(
        selectPosts(rows, {
          collection: 'post',
          locale: L,
          tag: slug,
          sort: 'newest',
          limit: rows.length,
          offset: 0
        })
      )
    }
  })

  it('a post repeating a term lands in that bucket exactly once', () => {
    const buckets = bucketPostsByTerm(published, (p) => p.categories)
    const b = buckets.get('recipes')!
    expect(b.filter((p) => p.slug === 'b')).toHaveLength(1)
  })

  it('null-dated posts sort last within a bucket (matches selectPosts)', () => {
    const buckets = bucketPostsByTerm(published, (p) => p.categories)
    const recipes = buckets.get('recipes')!.map((p) => p.slug)
    // date desc: a(300) > b(100) > d(null-last); e is published:false and excluded
    expect(recipes).toEqual(['a', 'b', 'd'])
  })
})

describe('memoFeedLocales', () => {
  const entries = [
    { id: `post/${L}/a`, data: {} },
    { id: 'post/fr/b', data: {} },
    { id: 'post/de/c', data: { published: false } }
  ]

  it('returns the same result as feedLocales', () => {
    expect(memoFeedLocales('k1', entries)).toEqual(feedLocales(entries))
  })

  it('memoizes per key: a repeat call with the same key ignores new input', () => {
    const first = memoFeedLocales('k2', entries)
    const second = memoFeedLocales('k2', [{ id: 'post/zz/x', data: {} }])
    expect(second).toBe(first) // same reference → served from cache
  })
})

describe('memoEntryIndex', () => {
  it('indexes by id and keeps the first entry on a duplicate id (matches Array.find)', () => {
    const a1 = { id: 'x', data: { n: 1 } }
    const a2 = { id: 'x', data: { n: 2 } }
    const idx = memoEntryIndex('e1', [a1, a2, { id: 'y', data: { n: 3 } }])
    expect(idx.get('x')).toBe(a1)
    expect(idx.get('y')?.data).toEqual({ n: 3 })
    expect(idx.get('missing')).toBeUndefined()
  })

  it('memoizes per key', () => {
    const idx1 = memoEntryIndex('e2', [{ id: 'a', data: {} }])
    const idx2 = memoEntryIndex('e2', [{ id: 'b', data: {} }])
    expect(idx2).toBe(idx1)
  })
})
