import { describe, it, expect } from 'vitest'
import {
  SITE_RESERVED_ROUTES,
  matchReservedRoute,
  findReservedRouteCollisions,
  formatReservedRouteCollisions,
  reservedRouteNamespaces
} from '../../src/permalinks/reserved-routes'

describe('matchReservedRoute', () => {
  it('a rest param matches its bare prefix and anything under it', () => {
    expect(matchReservedRoute('posts')).toBe('posts/[...page]')
    expect(matchReservedRoute('posts/2')).toBe('posts/[...page]')
    expect(matchReservedRoute('posts/some/deep/path')).toBe('posts/[...page]')
  })

  it('a one-segment param needs exactly one segment', () => {
    expect(matchReservedRoute('category')).toBeNull()
    expect(matchReservedRoute('category/recipes')).toBe(
      'category/[slug]/[...page]'
    )
    expect(matchReservedRoute('tag/astro/2')).toBe('tag/[slug]/[...page]')
    expect(matchReservedRoute('fr/rss.xml')).toBe('[locale]/rss.xml')
  })

  it('matches a param embedded inside a segment', () => {
    expect(matchReservedRoute('post-sitemap-1.xml')).toBe(
      'post-sitemap-[page].xml'
    )
    expect(matchReservedRoute('post-sitemap-.xml')).toBeNull()
  })

  it('matches exact static files and the dev preview route', () => {
    expect(matchReservedRoute('rss.xml')).toBe('rss.xml')
    expect(matchReservedRoute('robots.txt')).toBe('robots.txt')
    expect(matchReservedRoute('preview')).toBe('preview')
    expect(matchReservedRoute('_astro/x.css')).toBe('_astro/[...asset]')
  })

  it('treats literal dots as literal (rssXxml is not rss.xml)', () => {
    expect(matchReservedRoute('rssXxml')).toBeNull()
  })

  it('is case-insensitive (a case-insensitive filesystem merges the outputs)', () => {
    expect(matchReservedRoute('Posts')).toBe('posts/[...page]')
  })

  it('never reserves the site root or ordinary entry paths', () => {
    expect(matchReservedRoute('')).toBeNull()
    expect(matchReservedRoute('post/hello')).toBeNull()
    expect(matchReservedRoute('postscript')).toBeNull()
    expect(matchReservedRoute('blog/posts')).toBeNull()
    expect(matchReservedRoute('previews')).toBeNull()
  })
})

describe('findReservedRouteCollisions', () => {
  it('reports each colliding entry with its permalink and the route it hits', () => {
    const paths = new Map([
      ['page/en/posts', 'posts'],
      ['post/en/hello', 'post/hello'],
      ['post/en/two', 'posts/2']
    ])
    expect(findReservedRouteCollisions(paths)).toEqual([
      { id: 'page/en/posts', path: 'posts', route: 'posts/[...page]' },
      { id: 'post/en/two', path: 'posts/2', route: 'posts/[...page]' }
    ])
  })

  it('honours an id filter (unpublished entries get no route)', () => {
    const paths = new Map([['page/en/posts', 'posts']])
    expect(findReservedRouteCollisions(paths, () => false)).toEqual([])
  })
})

describe('formatReservedRouteCollisions', () => {
  it('names the entry, its permalink and the colliding route', () => {
    const msg = formatReservedRouteCollisions([
      { id: 'page/en/posts', path: 'posts', route: 'posts/[...page]' }
    ])
    expect(msg).toContain('"page/en/posts"')
    expect(msg).toContain('"/posts"')
    expect(msg).toContain('"/posts/[...page]"')
  })
})

describe('reservedRouteNamespaces', () => {
  it('is the literal first segment of every multi-segment route', () => {
    expect([...reservedRouteNamespaces()].sort()).toEqual([
      '_astro',
      'category',
      'posts',
      'tag'
    ])
  })

  it('every route in the list parses (no stray brackets)', () => {
    for (const r of SITE_RESERVED_ROUTES)
      expect(() => matchReservedRoute('x', [r])).not.toThrow()
  })
})

describe('matchReservedRoute — pattern edge cases', () => {
  it('matches params embedded in a segment, with literals on both sides', () => {
    const r = ['post-sitemap-[page].xml']
    expect(matchReservedRoute('post-sitemap-1.xml', r)).toBe(r[0])
    expect(matchReservedRoute('POST-SITEMAP-12.XML', r)).toBe(r[0])
    expect(matchReservedRoute('post-sitemap-.xml', r)).toBeNull() // a param needs ≥1 char
    expect(matchReservedRoute('post-sitemap-1.xmlx', r)).toBeNull()
    expect(matchReservedRoute('xpost-sitemap-1.xml', r)).toBeNull()
  })

  it('adjacent params need one char each', () => {
    const r = ['[a][b]']
    expect(matchReservedRoute('xy', r)).toBe(r[0])
    expect(matchReservedRoute('x', r)).toBeNull()
  })

  it('a rest param matches zero or more trailing segments, never empty ones', () => {
    const r = ['posts/[...page]']
    expect(matchReservedRoute('posts', r)).toBe(r[0])
    expect(matchReservedRoute('posts/2', r)).toBe(r[0])
    expect(matchReservedRoute('posts/a/b', r)).toBe(r[0])
    expect(matchReservedRoute('posts/', r)).toBeNull()
    expect(matchReservedRoute('postsx', r)).toBeNull()
  })

  it('rejects malformed patterns', () => {
    for (const bad of ['a]b', 'a[b', '[]', '[...x]/y', 'a[...x]'])
      expect(() => matchReservedRoute('q', [bad])).toThrow()
  })

  it('stays linear on a long adversarial path (no regex backtracking)', () => {
    const r = ['[a][b][c][d]x.xml']
    const t0 = performance.now()
    expect(matchReservedRoute('a'.repeat(50_000), r)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(200)
  })
})
