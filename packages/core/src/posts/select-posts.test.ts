import { describe, expect, it } from 'vitest'
import { selectPosts, type PostRow } from './select-posts'

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

const q = (extra: Partial<import('./select-posts').PostsQuery> = {}) => ({
  collection: 'post',
  locale: 'en',
  sort: 'newest' as const,
  limit: 10,
  offset: 0,
  ...extra
})

describe('selectPosts', () => {
  it('filters by collection and locale (excludes other-locale and other-collection)', () => {
    const rows = [
      row('a'),
      { ...row('b'), id: 'post/fr/b', locale: 'fr' },
      { ...row('c'), id: 'page/en/c', collection: 'page' }
    ]
    expect(selectPosts(rows, q()).map((r) => r.slug)).toEqual(['a'])
  })

  it('excludes only entries with published:false (absent/true stay)', () => {
    const rows = [
      row('a', { published: false }),
      row('b', { published: true }),
      row('c') // absent → published
    ]
    expect(selectPosts(rows, q()).map((r) => r.slug)).toEqual(['b', 'c'])
  })

  it('filters by category and tag when provided', () => {
    const rows = [
      row('a', { categories: ['news'], tags: ['x'] }),
      row('b', { categories: ['guides'], tags: ['x'] })
    ]
    expect(
      selectPosts(rows, q({ category: 'guides' })).map((r) => r.slug)
    ).toEqual(['b'])
    expect(selectPosts(rows, q({ tag: 'x' })).map((r) => r.slug)).toEqual([
      'a',
      'b'
    ])
  })

  it('sorts newest first with null dates last, id tiebreak', () => {
    const rows = [
      row('a', { date: 100 }),
      row('b', { date: null }),
      row('c', { date: 200 })
    ]
    expect(selectPosts(rows, q({ sort: 'newest' })).map((r) => r.slug)).toEqual(
      ['c', 'a', 'b']
    )
  })

  it('sorts oldest first with null dates still last', () => {
    const rows = [
      row('a', { date: 100 }),
      row('b', { date: null }),
      row('c', { date: 200 })
    ]
    expect(selectPosts(rows, q({ sort: 'oldest' })).map((r) => r.slug)).toEqual(
      ['a', 'c', 'b']
    )
  })

  it('sorts by title', () => {
    const rows = [row('b', { title: 'Banana' }), row('a', { title: 'Apple' })]
    expect(selectPosts(rows, q({ sort: 'title' })).map((r) => r.title)).toEqual(
      ['Apple', 'Banana']
    )
  })

  it('applies offset and limit', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((s) => row(s, { title: s }))
    expect(
      selectPosts(rows, q({ sort: 'title', offset: 1, limit: 2 })).map(
        (r) => r.slug
      )
    ).toEqual(['b', 'c'])
  })

  it('returns [] when offset is past the end', () => {
    expect(selectPosts([row('a')], q({ offset: 5 }))).toEqual([])
  })
})
