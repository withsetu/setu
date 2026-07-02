import { describe, it, expect } from 'vitest'
import { buildSitemap, buildRobotsTxt, type SitemapEntry } from '../src/lib/sitemap'

const e = (id: string, data: Record<string, unknown> = {}): SitemapEntry => ({ id, data })

describe('buildSitemap', () => {
  const site = 'https://example.com/'
  const home = 'page/en/home'

  it('lists the homepage + published entries as absolute, trailing-slash URLs', () => {
    const xml = buildSitemap([e('post/en/hello'), e('page/en/about')], site, home)
    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect(xml).toContain('<loc>https://example.com/post/hello/</loc>')
    expect(xml).toContain('<loc>https://example.com/page/about/</loc>')
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })

  it('excludes published:false and seo.noindex entries', () => {
    const xml = buildSitemap(
      [e('post/en/draft', { published: false }), e('post/en/hidden', { seo: { noindex: true } }), e('post/en/live')],
      site,
      home,
    )
    expect(xml).not.toContain('/post/draft/')
    expect(xml).not.toContain('/post/hidden/')
    expect(xml).toContain('/post/live/')
  })

  it('does not duplicate the home entry (already at /)', () => {
    const xml = buildSitemap([e('page/en/home')], site, home)
    expect((xml.match(/<loc>https:\/\/example\.com\/<\/loc>/g) ?? []).length).toBe(1)
    expect(xml).not.toContain('/page/home/')
  })

  it('includes lastmod only when provided, XML-safe', () => {
    const xml = buildSitemap([{ id: 'post/en/x', data: {}, lastmod: '2026-06-20T00:00:00.000Z' }], site, home)
    expect(xml).toContain('<lastmod>2026-06-20T00:00:00.000Z</lastmod>')
  })
})

describe('buildRobotsTxt', () => {
  it('allows all + advertises the sitemap when search-visible', () => {
    const txt = buildRobotsTxt(true, 'https://example.com/')
    expect(txt).toContain('User-agent: *')
    expect(txt).toContain('Allow: /')
    expect(txt).toContain('Sitemap: https://example.com/sitemap.xml')
  })

  it('disallows all when the site is hidden from search', () => {
    const txt = buildRobotsTxt(false, 'https://example.com/')
    expect(txt).toContain('Disallow: /')
    expect(txt).not.toContain('Sitemap:')
  })
})
