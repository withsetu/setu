import { describe, it, expect } from 'vitest'
import {
  resolvePermalinkMap,
  incumbentFromUrlMap
} from '../../src/permalinks/resolve-map'

const flat = () => ':slug' // every collection collapses to :slug — easy collisions

describe('resolvePermalinkMap', () => {
  it('resolves every entry through its collection pattern', () => {
    const { paths } = resolvePermalinkMap(
      [
        {
          id: 'post/en/a',
          collection: 'post',
          locale: 'en',
          slug: 'a',
          date: 1
        },
        {
          id: 'page/en/b',
          collection: 'page',
          locale: 'en',
          slug: 'b',
          date: null
        }
      ],
      (c) => (c === 'post' ? 'blog/:slug' : ':slug')
    )
    expect(paths.get('post/en/a')).toBe('blog/a')
    expect(paths.get('page/en/b')).toBe('b')
  })
  it('oldest keeps the clean URL; newer collisions get -2, -3 (with warnings)', () => {
    const { paths, warnings } = resolvePermalinkMap(
      [
        {
          id: 'post/en/about',
          collection: 'post',
          locale: 'en',
          slug: 'about',
          date: Date.UTC(2025, 0, 1)
        },
        {
          id: 'page/en/about',
          collection: 'page',
          locale: 'en',
          slug: 'about',
          date: Date.UTC(2026, 0, 1)
        },
        {
          id: 'doc/en/about',
          collection: 'doc',
          locale: 'en',
          slug: 'about',
          date: Date.UTC(2026, 5, 1)
        }
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
        {
          id: 'page/en/about',
          collection: 'page',
          locale: 'en',
          slug: 'about',
          date: null
        },
        {
          id: 'post/en/about',
          collection: 'post',
          locale: 'en',
          slug: 'about',
          date: Date.UTC(2026, 0, 1)
        }
      ],
      flat
    )
    expect(paths.get('post/en/about')).toBe('about')
    expect(paths.get('page/en/about')).toBe('about-2')
  })
  it('a suffixed candidate that is itself taken keeps incrementing', () => {
    const { paths } = resolvePermalinkMap(
      [
        {
          id: 'post/en/x',
          collection: 'post',
          locale: 'en',
          slug: 'x',
          date: 1
        },
        {
          id: 'post/en/x-2',
          collection: 'post',
          locale: 'en',
          slug: 'x-2',
          date: 2
        },
        {
          id: 'page/en/x',
          collection: 'page',
          locale: 'en',
          slug: 'x',
          date: 3
        }
      ],
      flat
    )
    expect(paths.get('post/en/x')).toBe('x')
    expect(paths.get('post/en/x-2')).toBe('x-2')
    expect(paths.get('page/en/x')).toBe('x-3')
  })
  it('is deterministic regardless of input order (stability: new entries never move old URLs)', () => {
    const entries = [
      {
        id: 'post/en/about',
        collection: 'post',
        locale: 'en',
        slug: 'about',
        date: Date.UTC(2025, 0, 1)
      },
      {
        id: 'page/en/about',
        collection: 'page',
        locale: 'en',
        slug: 'about',
        date: Date.UTC(2026, 0, 1)
      }
    ]
    const a = resolvePermalinkMap(entries, flat).paths
    const b = resolvePermalinkMap([...entries].reverse(), flat).paths
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b))
  })
})

/** #657 — incumbency beats date. Date-ascending order alone means a BACK-DATED new
 *  entry wins the clean URL and evicts the live page; `diffRedirects` then emits a 301
 *  whose `from` is simultaneously a live path, and on Cloudflare Pages `_redirects` is
 *  evaluated ahead of static assets, so the new page becomes unreachable. */
describe('resolvePermalinkMap incumbency (#657)', () => {
  const post = {
    id: 'post/en/hello',
    collection: 'post',
    locale: 'en',
    slug: 'hello',
    date: Date.UTC(2026, 0, 1)
  }
  const backdatedNote = {
    id: 'note/en/hello',
    collection: 'note',
    locale: 'en',
    slug: 'hello',
    date: Date.UTC(2020, 0, 1)
  }
  const blog = () => 'blog/:slug'

  it('without incumbency the older entry wins (documented date rule, unchanged)', () => {
    const { paths } = resolvePermalinkMap([post, backdatedNote], blog)
    expect(paths.get('note/en/hello')).toBe('blog/hello')
    expect(paths.get('post/en/hello')).toBe('blog/hello-2')
  })

  it('two-pass build: adding an older colliding entry does not move pass-1 paths', () => {
    const pass1 = resolvePermalinkMap([post], blog).paths
    expect(pass1.get('post/en/hello')).toBe('blog/hello')

    const pass2 = resolvePermalinkMap([post, backdatedNote], blog, {
      incumbent: pass1
    }).paths
    expect(pass2.get('post/en/hello')).toBe('blog/hello')
    expect(pass2.get('note/en/hello')).toBe('blog/hello-2')
  })

  it('a whole committed map is honoured, suffixes included', () => {
    const incumbent = new Map([
      ['post/en/hello', 'blog/hello'],
      ['page/en/hello', 'blog/hello-2']
    ])
    const page = {
      id: 'page/en/hello',
      collection: 'page',
      locale: 'en',
      slug: 'hello',
      date: Date.UTC(2027, 0, 1)
    }
    const { paths } = resolvePermalinkMap([post, page, backdatedNote], blog, {
      incumbent
    })
    expect(paths.get('post/en/hello')).toBe('blog/hello')
    expect(paths.get('page/en/hello')).toBe('blog/hello-2')
    expect(paths.get('note/en/hello')).toBe('blog/hello-3')
  })

  it('an incumbent whose own base path changed re-competes (a rename still moves)', () => {
    const renamed = { ...post, slug: 'hello-world', id: 'post/en/hello-world' }
    const incumbent = new Map([['post/en/hello-world', 'blog/hello']])
    const { paths } = resolvePermalinkMap([renamed], blog, { incumbent })
    expect(paths.get('post/en/hello-world')).toBe('blog/hello-world')
  })

  it('ids absent from the incumbent map still compete by date', () => {
    const incumbent = new Map([['post/en/hello', 'blog/hello']])
    const other = {
      id: 'doc/en/hello',
      collection: 'doc',
      locale: 'en',
      slug: 'hello',
      date: Date.UTC(2019, 0, 1)
    }
    const { paths } = resolvePermalinkMap([post, backdatedNote, other], blog, {
      incumbent
    })
    expect(paths.get('post/en/hello')).toBe('blog/hello')
    // doc (2019) is older than note (2020), so it takes the first free suffix.
    expect(paths.get('doc/en/hello')).toBe('blog/hello-2')
    expect(paths.get('note/en/hello')).toBe('blog/hello-3')
  })

  it('a stale incumbent claim on a path another incumbent holds is not double-granted', () => {
    const incumbent = new Map([
      ['post/en/hello', 'blog/hello'],
      ['note/en/hello', 'blog/hello']
    ])
    const { paths } = resolvePermalinkMap([post, backdatedNote], blog, {
      incumbent
    })
    const all = [paths.get('post/en/hello'), paths.get('note/en/hello')]
    expect(new Set(all).size).toBe(2)
    expect(all).toContain('blog/hello')
  })
})

describe('incumbentFromUrlMap (#657)', () => {
  it('re-keys a cid-keyed, slash-prefixed snapshot onto entry ids', () => {
    const inc = incumbentFromUrlMap(
      { 'cid-a': '/blog/hello', 'cid-b': '/', 'cid-c': '/page/x' },
      [
        { id: 'post/en/hello', cid: 'cid-a' },
        { id: 'page/en/home', cid: 'cid-b' },
        { id: 'post/en/new', cid: undefined },
        { id: 'post/en/unmapped', cid: 'cid-zzz' }
      ]
    )
    expect(inc.get('post/en/hello')).toBe('blog/hello')
    expect(inc.get('page/en/home')).toBe('') // site root
    expect(inc.has('post/en/new')).toBe(false)
    expect(inc.has('post/en/unmapped')).toBe(false)
  })

  it('a missing snapshot yields no claims (first build competes on date)', () => {
    expect(incumbentFromUrlMap(null, [{ id: 'a', cid: 'c' }]).size).toBe(0)
  })
})
