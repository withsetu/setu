import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@setu/core'
import { pageSeo } from '../src/lib/seo'
import { toFeedItem } from '../src/lib/feed'
import { withTrailingSlash, entryUrls } from '../src/lib/sitemap'

// #860 SEO-1: the sitemap, hreflang alternates, and the self-canonical were built in three
// independent places that disagreed on the trailing slash (`/about` vs `/about/`), splitting the
// canonical/translation-cluster signal. All three now route through the ONE `withTrailingSlash`
// normalizer. This suite pins that they emit the identical URL for the same entry.
const SITE = new URL('https://example.com')

describe('withTrailingSlash normalizer', () => {
  it('adds exactly one trailing slash and preserves the root + already-slashed paths', () => {
    expect(withTrailingSlash('https://example.com/about')).toBe(
      'https://example.com/about/'
    )
    expect(withTrailingSlash('https://example.com/about/')).toBe(
      'https://example.com/about/'
    )
    expect(withTrailingSlash('https://example.com/')).toBe(
      'https://example.com/'
    )
    expect(withTrailingSlash('https://example.com')).toBe(
      'https://example.com/'
    )
  })
})

describe('canonical / hreflang / sitemap agree on the trailing-slash form (#860 SEO-1)', () => {
  const EXPECTED = 'https://example.com/about/'

  it('a slash-less path yields the same URL from all three constructions', () => {
    // canonical: derived from the (slash-less) served pathname.
    const seo = pageSeo(SITE, '/about', '', DEFAULT_SETTINGS, {
      title: 'About',
      // hreflang: the page passes slash-less alternate paths; a second variant makes hreflang emit.
      alternates: [
        { locale: 'en', path: '/about' },
        { locale: 'fr', path: '/a-propos' }
      ]
    })
    const canonical = seo.meta.find((m) => m.property === 'og:url')?.content
    const enHref = seo.alternates?.find((a) => a.hreflang === 'en')?.href

    // sitemap: the same entry through the loc builder (custom resolver → the same 'about' path).
    const sitemapLoc = entryUrls(
      [{ id: 'post/en/about', data: {} }],
      'post',
      'https://example.com/',
      'page/en/home',
      '',
      () => 'about'
    )[0]?.loc

    expect(canonical).toBe(EXPECTED)
    expect(enHref).toBe(EXPECTED)
    expect(sitemapLoc).toBe(EXPECTED)
  })

  it('a per-page canonical override is kept verbatim (not normalized)', () => {
    const seo = pageSeo(SITE, '/about', '', DEFAULT_SETTINGS, {
      canonical: 'https://example.com/canonical-target'
    })
    // The override is an explicit author choice — no forced trailing slash.
    expect(seo.meta.find((m) => m.property === 'og:url')?.content).toBe(
      'https://example.com/canonical-target'
    )
  })
})

describe('RSS feed item link shares the one trailing-slash policy (#887)', () => {
  it('a feed item link ends with a slash, matching the canonical/sitemap path', () => {
    // #866 normalized canonical/hreflang/sitemap to trailing-slash but left the feed link the
    // lone holdout (#887). The feed link is a RELATIVE path (@astrojs/rss absolutizes it against
    // `site`), so it routes through the path-level `ensureTrailingSlashPath` that `withTrailingSlash`
    // itself now delegates to — one policy, two entry points (URL-level and path-level).
    const item = toFeedItem(
      {
        id: 'post/en/about',
        data: { title: 'About' },
        body: '',
        date: new Date(0)
      },
      // pathOf resolves an id to its permalink path (no leading slash), like the real permalink map.
      () => 'post/en/about'
    )
    expect(item.link).toBe('/post/en/about/')

    // The absolutized item link must equal the sitemap loc for the same entry — four-way agreement.
    const sitemapLoc = entryUrls(
      [{ id: 'post/en/about', data: {} }],
      'post',
      'https://example.com/',
      'page/en/home',
      '',
      () => 'post/en/about'
    )[0]?.loc
    expect(new URL(item.link, SITE).href).toBe(sitemapLoc)
  })

  it('the homepage-ish empty path stays a single root slash, not "//"', () => {
    const item = toFeedItem(
      { id: 'x', data: { title: 'X' }, body: '', date: new Date(0) },
      () => ''
    )
    expect(item.link).toBe('/')
  })
})
