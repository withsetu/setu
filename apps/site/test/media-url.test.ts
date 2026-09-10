import { describe, expect, it } from 'vitest'
import { absoluteMediaUrl } from '../src/lib/url'
import { absMedia } from '../src/lib/seo'
import { entryImages } from '../src/lib/sitemap'
import { mediaItemUrl } from '../src/lib/rss-xml'

/**
 * #1113: the same raw media value used to be resolved by three separate implementations — SEO's
 * `absMedia`, the sitemap's inline resolver, and the feed's `mediaItemUrl` — and #861 fixed the
 * protocol-relative case in exactly one of them. `//cdn.example/hero.jpg` therefore produced a
 * correct `og:image`, a sitemap `<image:loc>` pointing at a 404 on our own origin, and an RSS
 * enclosure on the wrong host, from one post.
 *
 * The table below is the contract. The second suite is the part that matters structurally: it
 * asserts the three CALL SITES agree on every row, so a future fix landing in one copy again fails
 * here rather than shipping.
 */
const SITE = 'https://example.com'
const MEDIA = 'https://cdn.example.net'

const CASES: { raw: string; mediaBase: string; expect: string; why: string }[] =
  [
    {
      raw: '//images.cdn.org/hero.jpg',
      mediaBase: MEDIA,
      expect: 'https://images.cdn.org/hero.jpg',
      why: 'protocol-relative is ALREADY absolute — it must never get the media base (#861 SEO-4)'
    },
    {
      raw: '//images.cdn.org/hero.jpg',
      mediaBase: '',
      expect: 'https://images.cdn.org/hero.jpg',
      why: 'and it must not get the site origin either, with or without a media base'
    },
    {
      raw: 'https://other.example/a.png',
      mediaBase: MEDIA,
      expect: 'https://other.example/a.png',
      why: 'an absolute http(s) URL passes through untouched'
    },
    {
      raw: '/media/photo.jpg',
      mediaBase: MEDIA,
      expect: `${MEDIA}/media/photo.jpg`,
      why: 'root-relative media goes through the media base'
    },
    {
      raw: '/media/photo.jpg',
      mediaBase: '',
      expect: `${SITE}/media/photo.jpg`,
      why: 'with no media base it falls back to the site origin'
    },
    {
      raw: '/uploads/legacy.png',
      mediaBase: MEDIA,
      expect: `${MEDIA}/uploads/legacy.png`,
      why: 'root-relative outside /media/ is still root-relative — an imported site is full of these'
    },
    {
      raw: 'relative.jpg',
      mediaBase: '',
      expect: `${SITE}/relative.jpg`,
      why: 'a bare relative path resolves against the site origin'
    }
  ]

describe('absoluteMediaUrl', () => {
  it.each(CASES)('$raw (mediaBase=$mediaBase) → $expect — $why', (c) => {
    expect(absoluteMediaUrl(c.raw, c.mediaBase, `${SITE}/`)).toBe(c.expect)
  })

  it('returns undefined for an empty value rather than the bare origin', () => {
    expect(absoluteMediaUrl('', MEDIA, `${SITE}/`)).toBeUndefined()
    expect(absoluteMediaUrl(undefined, MEDIA, `${SITE}/`)).toBeUndefined()
  })
})

describe('all three call sites resolve identically', () => {
  it.each(CASES)('$raw — seo, sitemap and feed agree', (c) => {
    const viaSeo = absMedia(c.raw, c.mediaBase, new URL(`${SITE}/`))
    const viaFeed = mediaItemUrl(c.raw, c.mediaBase, `${SITE}/`)
    const viaSitemap = entryImages(
      { id: 'post/en/x', data: { featuredImage: c.raw }, lastmod: undefined },
      c.mediaBase,
      SITE
    )

    expect(viaSeo).toBe(c.expect)
    expect(viaFeed).toBe(c.expect)
    // entryImages returns the deduped list; the featured image is first.
    expect(viaSitemap[0]).toBe(c.expect)
  })
})
