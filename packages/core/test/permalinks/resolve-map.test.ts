import { describe, it, expect } from 'vitest'
import { resolvePermalinkMap } from '../../src/permalinks/resolve-map'

const flat = () => ':slug' // every collection collapses to :slug — easy collisions

describe('resolvePermalinkMap', () => {
  it('resolves every entry through its collection pattern', () => {
    const { paths } = resolvePermalinkMap(
      [
        { id: 'post/en/a', collection: 'post', locale: 'en', slug: 'a', date: 1 },
        { id: 'page/en/b', collection: 'page', locale: 'en', slug: 'b', date: null }
      ],
      (c) => (c === 'post' ? 'blog/:slug' : ':slug')
    )
    expect(paths.get('post/en/a')).toBe('blog/a')
    expect(paths.get('page/en/b')).toBe('b')
  })
  it('oldest keeps the clean URL; newer collisions get -2, -3 (with warnings)', () => {
    const { paths, warnings } = resolvePermalinkMap(
      [
        { id: 'post/en/about', collection: 'post', locale: 'en', slug: 'about', date: Date.UTC(2025, 0, 1) },
        { id: 'page/en/about', collection: 'page', locale: 'en', slug: 'about', date: Date.UTC(2026, 0, 1) },
        { id: 'doc/en/about', collection: 'doc', locale: 'en', slug: 'about', date: Date.UTC(2026, 5, 1) }
      ],
      flat
    )
    expect(paths.get('post/en/about')).toBe('about')
    expect(paths.get('page/en/about')).toBe('about-2')
    expect(paths.get('doc/en/about')).toBe('about-3')
    expect(warnings.filter((w) => w.includes('collision'))).toHaveLength(2)
  })
  it('date-less entries lose to dated ones; id is the tiebreak', () => {
    const { paths } = resolvePermalinkMap(
      [
        { id: 'page/en/about', collection: 'page', locale: 'en', slug: 'about', date: null },
        { id: 'post/en/about', collection: 'post', locale: 'en', slug: 'about', date: Date.UTC(2026, 0, 1) }
      ],
      flat
    )
    expect(paths.get('post/en/about')).toBe('about')
    expect(paths.get('page/en/about')).toBe('about-2')
  })
  it('a suffixed candidate that is itself taken keeps incrementing', () => {
    const { paths } = resolvePermalinkMap(
      [
        { id: 'post/en/x', collection: 'post', locale: 'en', slug: 'x', date: 1 },
        { id: 'post/en/x-2', collection: 'post', locale: 'en', slug: 'x-2', date: 2 },
        { id: 'page/en/x', collection: 'page', locale: 'en', slug: 'x', date: 3 }
      ],
      flat
    )
    expect(paths.get('post/en/x')).toBe('x')
    expect(paths.get('post/en/x-2')).toBe('x-2')
    expect(paths.get('page/en/x')).toBe('x-3')
  })
  it('is deterministic regardless of input order (stability: new entries never move old URLs)', () => {
    const entries = [
      { id: 'post/en/about', collection: 'post', locale: 'en', slug: 'about', date: Date.UTC(2025, 0, 1) },
      { id: 'page/en/about', collection: 'page', locale: 'en', slug: 'about', date: Date.UTC(2026, 0, 1) }
    ]
    const a = resolvePermalinkMap(entries, flat).paths
    const b = resolvePermalinkMap([...entries].reverse(), flat).paths
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b))
  })
})
