import { describe, it, expect } from 'vitest'
import {
  isIndexable,
  entryUrls,
  taxonomyUrls,
  collectSitemapSections,
  sitemapIndexXml,
  urlSitemapXml,
  newestLastmod,
  buildRobotsTxt,
  type SitemapEntry,
  type SitemapConfig,
} from '../src/lib/sitemap'

const e = (id: string, data: Record<string, unknown> = {}): SitemapEntry => ({ id, data })
const SITE = 'https://example.com/'
const HOME = 'page/en/home'
const ALL: SitemapConfig = { posts: true, pages: true, categories: true, tags: true }

describe('isIndexable', () => {
  it('excludes published:false and seo.noindex, keeps the rest', () => {
    expect(isIndexable({})).toBe(true)
    expect(isIndexable({ published: false })).toBe(false)
    expect(isIndexable({ seo: { noindex: true } })).toBe(false)
  })
})

describe('entryUrls', () => {
  it('posts → indexable post URLs as trailing-slash absolutes', () => {
    const urls = entryUrls([e('post/en/hello'), e('post/en/draft', { published: false }), e('page/en/about')], 'post', SITE, HOME)
    expect(urls.map((u) => u.loc)).toEqual(['https://example.com/post/hello/'])
  })
  it('pages → homepage at / plus page entries, home entry not duplicated', () => {
    const urls = entryUrls([e('page/en/home'), e('page/en/about')], 'page', SITE, HOME)
    expect(urls.map((u) => u.loc)).toEqual(['https://example.com/', 'https://example.com/page/about/'])
  })
})

describe('taxonomyUrls', () => {
  it('maps slugs to /category|tag/slug/', () => {
    expect(taxonomyUrls(['news', 'guides'], 'category', SITE).map((u) => u.loc)).toEqual([
      'https://example.com/category/news/',
      'https://example.com/category/guides/',
    ])
    expect(taxonomyUrls(['astro'], 'tag', SITE)[0].loc).toBe('https://example.com/tag/astro/')
  })
})

describe('collectSitemapSections', () => {
  const entries = [
    e('post/en/a', { categories: ['news'], tags: ['x'] }),
    e('post/en/b', { categories: ['guides'], tags: ['x'] }),
    e('post/en/hidden', { published: false, categories: ['secret'] }),
    e('page/en/about'),
  ]
  it('populates every section and derives taxonomy from published posts', () => {
    const s = collectSitemapSections(entries, ALL, SITE, HOME)
    expect(s.post.map((u) => u.loc)).toEqual(['https://example.com/post/a/', 'https://example.com/post/b/'])
    expect(s.page.some((u) => u.loc === 'https://example.com/page/about/')).toBe(true)
    expect(s.category.map((u) => u.loc)).toEqual(expect.arrayContaining(['https://example.com/category/news/', 'https://example.com/category/guides/']))
    expect(s.category.some((u) => u.loc.includes('/secret/'))).toBe(false) // from an unpublished post
    expect(s.tag.map((u) => u.loc)).toEqual(['https://example.com/tag/x/'])
  })
  it('disabled sections come back empty', () => {
    const s = collectSitemapSections(entries, { posts: true, pages: false, categories: false, tags: false }, SITE, HOME)
    expect(s.post.length).toBeGreaterThan(0)
    expect(s.page).toEqual([])
    expect(s.category).toEqual([])
    expect(s.tag).toEqual([])
  })
})

describe('xml builders', () => {
  it('index is a <sitemapindex> referencing the stylesheet + sub-sitemaps', () => {
    const xml = sitemapIndexXml([{ loc: 'https://example.com/post-sitemap.xml', lastmod: '2026-06-20T00:00:00.000Z' }])
    expect(xml).toContain('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>')
    expect(xml).toContain('<sitemapindex')
    expect(xml).toContain('<loc>https://example.com/post-sitemap.xml</loc>')
    expect(xml).toContain('<lastmod>2026-06-20T00:00:00.000Z</lastmod>')
  })
  it('urlset references the stylesheet', () => {
    expect(urlSitemapXml([{ loc: 'https://example.com/post/x/' }])).toContain('<urlset')
  })
  it('newestLastmod picks the max ISO date', () => {
    expect(newestLastmod([{ loc: 'a', lastmod: '2026-01-01' }, { loc: 'b', lastmod: '2026-06-20' }])).toBe('2026-06-20')
    expect(newestLastmod([{ loc: 'a' }])).toBeUndefined()
  })
})

describe('buildRobotsTxt', () => {
  it('allows + advertises the sitemap when visible; disallows when hidden', () => {
    expect(buildRobotsTxt(true, SITE)).toContain('Sitemap: https://example.com/sitemap.xml')
    const hidden = buildRobotsTxt(false, SITE)
    expect(hidden).toContain('Disallow: /')
    expect(hidden).not.toContain('Sitemap:')
  })
})
