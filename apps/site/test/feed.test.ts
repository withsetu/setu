import { describe, it, expect } from 'vitest'
import {
  excerpt,
  selectFeedPosts,
  toFeedItem,
  feedLocales,
  feedCategories,
  type FeedRow
} from '../src/lib/feed'

const row = (
  id: string,
  date: string,
  data: Record<string, unknown> = {},
  body = ''
): FeedRow => ({
  id,
  data: { title: 'T', ...data },
  body,
  date: new Date(date)
})

describe('excerpt', () => {
  it('strips markdoc tags + truncates on a word boundary', () => {
    const out = excerpt(
      '{% callout %}Hello{% /callout %} ' + 'word '.repeat(80)
    )
    expect(out).not.toContain('{%')
    expect(out.length).toBeLessThanOrEqual(201)
    expect(out.endsWith('…')).toBe(true)
  })
  it('leaves short text unchanged (no ellipsis)', () => {
    expect(excerpt('Just a short body.')).toBe('Just a short body.')
  })
})

describe('selectFeedPosts', () => {
  const rows: FeedRow[] = [
    row('post/en/a', '2024-01-01'),
    row('post/en/b', '2024-03-01'),
    row('page/en/about', '2024-09-01'), // page → excluded
    // A vestigial frontmatter `status` field is NOT Setu's draft signal — committed content is
    // published; drafts live only in the DB. So this stays IN the feed (matches the site + lifecycle).
    row('post/en/legacy-status', '2024-12-01', { status: 'draft' }),
    row('post/en/hidden', '2024-12-01', { published: false }), // published:false → excluded (the real signal)
    row('post/fr/c', '2024-12-01') // non-en → excluded
  ]
  it('keeps published en posts (committed, not published:false), newest first, capped at limit', () => {
    const out = selectFeedPosts(rows, 10).map((r) => r.id)
    expect(out).toEqual(['post/en/legacy-status', 'post/en/b', 'post/en/a'])
  })
  it('caps at the limit', () => {
    expect(selectFeedPosts(rows, 1).map((r) => r.id)).toEqual([
      'post/en/legacy-status'
    ])
  })
})

describe('selectFeedPosts — non-default locale', () => {
  it('selects only the requested locale, newest first', () => {
    const rows: FeedRow[] = [
      row('post/en/a', '2024-01-01'),
      row('post/fr/x', '2024-02-01'),
      row('post/fr/y', '2024-03-01')
    ]
    expect(selectFeedPosts(rows, 10, 'fr').map((r) => r.id)).toEqual([
      'post/fr/y',
      'post/fr/x'
    ])
    expect(selectFeedPosts(rows, 10, 'en').map((r) => r.id)).toEqual([
      'post/en/a'
    ])
  })
})

// Stub id → path resolver standing in for the real permalink map (injected so `toFeedItem`
// stays pure/testable without astro:content). Mirrors the pre-permalink-patterns default
// pattern's shape (locale dropped, collection/slug kept).
const pathOf = (id: string): string => id.replace(/^([^/]+)\/[^/]+\//, '$1/')

describe('toFeedItem', () => {
  it('builds an absolute-path link and falls back to excerpt for description', () => {
    const item = toFeedItem(
      row('post/en/my-post', '2024-01-01', {}, 'Body text here.'),
      pathOf
    )
    expect(item.link).toBe('/post/my-post')
    expect(item.description).toBe('Body text here.')
  })
  it('prefers frontmatter description/summary', () => {
    expect(
      toFeedItem(row('post/en/x', '2024-01-01', { description: 'D' }), pathOf)
        .description
    ).toBe('D')
    expect(
      toFeedItem(row('post/en/x', '2024-01-01', { summary: 'S' }), pathOf)
        .description
    ).toBe('S')
  })
  it('carries categories (categories then tags, deduped) and the raw featured image', () => {
    const item = toFeedItem(
      row('post/en/x', '2024-01-01', {
        categories: ['Recipes', 'Dinner'],
        tags: ['dinner', 'quick'],
        featuredImage: '/media/2026/06/x.jpg'
      }),
      pathOf
    )
    expect(item.categories).toEqual(['Recipes', 'Dinner', 'dinner', 'quick'])
    expect(item.image).toBe('/media/2026/06/x.jpg')
  })
  it('omits the image when there is no featuredImage', () => {
    expect(
      toFeedItem(row('post/en/x', '2024-01-01'), pathOf).image
    ).toBeUndefined()
    expect(
      toFeedItem(row('post/en/x', '2024-01-01'), pathOf).categories
    ).toEqual([])
  })
})

describe('feedCategories', () => {
  it('merges categories then tags, preserving order', () => {
    expect(feedCategories({ categories: ['A', 'B'], tags: ['c'] })).toEqual([
      'A',
      'B',
      'c'
    ])
  })
  it('accepts a bare string for either field', () => {
    expect(feedCategories({ categories: 'Solo', tags: 'one' })).toEqual([
      'Solo',
      'one'
    ])
  })
  it('dedupes across categories and tags, dropping empties', () => {
    expect(
      feedCategories({ categories: ['x', '', 'y'], tags: ['y', 'z'] })
    ).toEqual(['x', 'y', 'z'])
  })
  it('returns [] when neither field is present', () => {
    expect(feedCategories({})).toEqual([])
    expect(feedCategories({ categories: undefined, tags: [] })).toEqual([])
  })
})

describe('feedLocales', () => {
  it('returns distinct published-post locales, default locale first', () => {
    const entries = [
      { id: 'post/fr/x', data: {} },
      { id: 'post/en/a', data: {} },
      { id: 'post/de/z', data: { published: false } }, // only-unpublished locale → excluded
      { id: 'page/en/about', data: {} } // page → ignored
    ]
    expect(feedLocales(entries)).toEqual(['en', 'fr'])
  })
  it('single-locale → just the default', () => {
    expect(feedLocales([{ id: 'post/en/a', data: {} }])).toEqual(['en'])
  })
})
