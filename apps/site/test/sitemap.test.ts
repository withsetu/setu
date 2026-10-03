import { describe, it, expect } from 'vitest'
import {
  isIndexable,
  entryUrls,
  entryImages,
  entryVideos,
  taxonomyUrls,
  collectSitemapSections,
  sitemapIndexXml,
  urlSitemapXml,
  newestLastmod,
  buildRobotsTxt,
  chunkSitemapUrls,
  sitemapIndexEntries,
  POST_SITEMAP_MAX,
  type SitemapEntry,
  type SitemapConfig,
  type SitemapUrl
} from '../src/lib/sitemap'
import { taxonomyArchivePath } from '@setu/core'

const e = (id: string, data: Record<string, unknown> = {}): SitemapEntry => ({
  id,
  data
})
const SITE = 'https://example.com/'
const HOME = 'page/en/home'
const ALL: SitemapConfig = {
  posts: true,
  pages: true,
  categories: true,
  tags: true
}

describe('isIndexable', () => {
  it('excludes published:false and seo.noindex, keeps the rest', () => {
    expect(isIndexable({})).toBe(true)
    expect(isIndexable({ published: false })).toBe(false)
    expect(isIndexable({ seo: { noindex: true } })).toBe(false)
  })
})

describe('entryUrls', () => {
  it('posts → indexable post URLs as trailing-slash absolutes', () => {
    const urls = entryUrls(
      [
        e('post/en/hello'),
        e('post/en/draft', { published: false }),
        e('page/en/about')
      ],
      'post',
      SITE,
      HOME
    )
    expect(urls.map((u) => u.loc)).toEqual(['https://example.com/post/hello/'])
  })
  it('pages → homepage at / plus page entries, home entry not duplicated', () => {
    const urls = entryUrls(
      [e('page/en/home'), e('page/en/about')],
      'page',
      SITE,
      HOME
    )
    expect(urls.map((u) => u.loc)).toEqual([
      'https://example.com/',
      'https://example.com/page/about/'
    ])
  })

  // The collision-aware permalink map with `reading.homepage: page/en/landing`: the configured
  // homepage owns '' and page/en/home is an ordinary page (permalinks.ts root overrides, #660).
  const landingMap: Record<string, string> = {
    'page/en/landing': '',
    'page/en/home': 'page/home',
    'page/en/about': 'page/about'
  }
  const viaLandingMap = (id: string) => landingMap[id]

  it('non-default homepage: page/en/home is listed at its own path, not hard-skipped (#1120)', () => {
    const urls = entryUrls(
      [e('page/en/home'), e('page/en/landing'), e('page/en/about')],
      'page',
      SITE,
      'page/en/landing',
      '',
      viaLandingMap
    )
    expect(urls.map((u) => u.loc)).toEqual([
      'https://example.com/',
      'https://example.com/page/home/',
      'https://example.com/page/about/'
    ])
  })

  it('non-default homepage that is a draft: page/en/home takes the root, as index.astro serves it (#165)', () => {
    const urls = entryUrls(
      [
        e('page/en/home'),
        e('page/en/landing', { published: false }),
        e('page/en/about')
      ],
      'page',
      SITE,
      'page/en/landing',
      '',
      viaLandingMap
    )
    expect(urls.map((u) => u.loc)).toEqual([
      'https://example.com/',
      'https://example.com/page/about/'
    ])
  })

  it('a seo.noindex homepage is not advertised at the site root (#1120)', () => {
    const noindexHome = entryUrls(
      [e('page/en/home', { seo: { noindex: true } }), e('page/en/about')],
      'page',
      SITE,
      HOME
    )
    expect(noindexHome.map((u) => u.loc)).toEqual([
      'https://example.com/page/about/'
    ])
    // …and a non-default noindex homepage is neither at / nor at its own path.
    const noindexLanding = entryUrls(
      [
        e('page/en/home'),
        e('page/en/landing', { seo: { noindex: true } }),
        e('page/en/about')
      ],
      'page',
      SITE,
      'page/en/landing',
      '',
      viaLandingMap
    )
    expect(noindexLanding.map((u) => u.loc)).toEqual([
      'https://example.com/page/home/',
      'https://example.com/page/about/'
    ])
  })

  it('no home entry at all: the root (index.astro’s empty shell) is still listed', () => {
    const urls = entryUrls([e('page/en/about')], 'page', SITE, HOME)
    expect(urls.map((u) => u.loc)).toEqual([
      'https://example.com/',
      'https://example.com/page/about/'
    ])
  })
})

describe('taxonomyUrls', () => {
  it('maps slugs to /category|tag/slug/', () => {
    expect(
      taxonomyUrls(['news', 'guides'], 'category', SITE).map((u) => u.loc)
    ).toEqual([
      'https://example.com/category/news/',
      'https://example.com/category/guides/'
    ])
    expect(taxonomyUrls(['astro'], 'tag', SITE)[0].loc).toBe(
      'https://example.com/tag/astro/'
    )
  })

  it('encodes a special-char slug exactly as taxonomyArchivePath (the chip href + canonical) (#860, #1120)', () => {
    // `#`/`?` keep Astro's route-generator encoding (a `#`-tag otherwise truncates at the fragment).
    expect(taxonomyUrls(['c#4'], 'tag', SITE)[0].loc).toBe(
      'https://example.com/tag/c%234/'
    )
    expect(taxonomyUrls(['a?b'], 'tag', SITE)[0].loc).toBe(
      'https://example.com/tag/a%3Fb/'
    )
  })

  it('a spaced or non-ASCII tag is a valid URL, byte-identical to the shared path helper (#1120)', () => {
    const [spaced, accented] = taxonomyUrls(['web dev', 'café'], 'tag', SITE)
    expect(spaced.loc).toBe('https://example.com/tag/web%20dev/')
    expect(accented.loc).toBe('https://example.com/tag/caf%C3%A9/')
    for (const { loc } of [spaced, accented]) {
      expect(loc).not.toMatch(/\s/)
      // A valid absolute URL that re-serializes to itself — the canonical's spelling.
      expect(new URL(loc).href).toBe(loc)
    }
    expect(spaced.loc).toBe(
      `https://example.com${taxonomyArchivePath('tag', 'web dev')}`
    )
  })
})

describe('taxonomyUrls locale (#1114)', () => {
  it('prefixes a non-default locale and leaves the default unprefixed', () => {
    expect(taxonomyUrls(['voyage'], 'tag', SITE, 'fr')[0].loc).toBe(
      'https://example.com/fr/tag/voyage/'
    )
    expect(taxonomyUrls(['astro'], 'tag', SITE, 'en')[0].loc).toBe(
      'https://example.com/tag/astro/'
    )
  })
})

describe('chunkSitemapUrls (#859 SITE-03)', () => {
  const u = (n: number): SitemapUrl[] =>
    Array.from({ length: n }, (_, i) => ({
      loc: `https://example.com/post/p${i}/`
    }))

  it('splits at the threshold, keeps every shard within the cap, loses no URL', () => {
    const chunks = chunkSitemapUrls(u(5), 2)
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1])
    expect(chunks.every((c) => c.length <= 2)).toBe(true)
    expect(chunks.flat()).toHaveLength(5)
    // The sitemap index lists one <loc> per shard → N here.
    expect(chunks).toHaveLength(3)
  })

  it('a list at or under the cap is a single shard; empty is no shards', () => {
    expect(chunkSitemapUrls(u(2), 2)).toHaveLength(1)
    expect(chunkSitemapUrls([], 2)).toEqual([])
  })

  it('the cap is the sitemaps.org 50,000-URL limit and is the default chunk size (#1120)', () => {
    // Pin the number itself: raising it past the protocol limit must fail here, not in Search
    // Console.
    expect(POST_SITEMAP_MAX).toBe(50_000)
    // cap + 1 URLs → two shards with no explicit size: proves the DEFAULT is the cap.
    const chunks = chunkSitemapUrls(u(POST_SITEMAP_MAX + 1))
    expect(chunks.map((c) => c.length)).toEqual([POST_SITEMAP_MAX, 1])
    expect(chunkSitemapUrls(u(POST_SITEMAP_MAX))).toHaveLength(1)
    expect(() => chunkSitemapUrls(u(3), 0)).toThrow(RangeError)
  })
})

describe('collectSitemapSections', () => {
  const entries = [
    e('post/en/a', { categories: ['news'], tags: ['x'] }),
    e('post/en/b', { categories: ['guides'], tags: ['x'] }),
    e('post/en/hidden', { published: false, categories: ['secret'] }),
    e('page/en/about')
  ]
  it('populates every section and derives taxonomy from published posts', () => {
    const s = collectSitemapSections(entries, ALL, SITE, HOME)
    expect(s.post.map((u) => u.loc)).toEqual([
      'https://example.com/post/a/',
      'https://example.com/post/b/'
    ])
    expect(
      s.page.some((u) => u.loc === 'https://example.com/page/about/')
    ).toBe(true)
    expect(s.category.map((u) => u.loc)).toEqual(
      expect.arrayContaining([
        'https://example.com/category/news/',
        'https://example.com/category/guides/'
      ])
    )
    expect(s.category.some((u) => u.loc.includes('/secret/'))).toBe(false) // from an unpublished post
    expect(s.tag.map((u) => u.loc)).toEqual(['https://example.com/tag/x/'])
  })
  it('lists per-locale archives for terms that have a post in that locale (#1114)', () => {
    const s = collectSitemapSections(
      [
        ...entries,
        e('post/fr/a', { categories: ['news'], tags: ['x', 'voyage'] }),
        e('post/fr/hidden', { published: false, tags: ['cache'] })
      ],
      ALL,
      SITE,
      HOME
    )
    // Default locale block first and unchanged, then the fr archives.
    expect(s.tag.map((u) => u.loc)).toEqual([
      'https://example.com/tag/x/',
      'https://example.com/fr/tag/voyage/',
      'https://example.com/fr/tag/x/'
    ])
    expect(s.category.map((u) => u.loc)).toEqual([
      'https://example.com/category/guides/',
      'https://example.com/category/news/',
      'https://example.com/fr/category/news/'
    ])
    // A fr-only tag never invents an unprefixed archive; an unpublished fr post emits nothing.
    expect(s.tag.some((u) => u.loc === 'https://example.com/tag/voyage/')).toBe(
      false
    )
    expect(s.tag.some((u) => u.loc.includes('/cache/'))).toBe(false)
  })
  it('disabled sections come back empty', () => {
    const s = collectSitemapSections(
      entries,
      { posts: true, pages: false, categories: false, tags: false },
      SITE,
      HOME
    )
    expect(s.post.length).toBeGreaterThan(0)
    expect(s.page).toEqual([])
    expect(s.category).toEqual([])
    expect(s.tag).toEqual([])
  })
})

describe('entryImages', () => {
  const MEDIA = 'https://media.example.com'
  it('featured image first, /media/ resolved through the media base', () => {
    const imgs = entryImages(
      { id: 'post/en/x', data: { featuredImage: '/media/2026/06/cat.jpg' } },
      MEDIA,
      SITE
    )
    expect(imgs).toEqual(['https://media.example.com/media/2026/06/cat.jpg'])
  })
  it('collects in-body image URLs (markdown + absolute), deduped, non-images ignored', () => {
    const imgs = entryImages(
      {
        id: 'post/en/x',
        data: { featuredImage: 'https://cdn.example.com/hero.webp' },
        body: '![a](/media/2026/06/a.png) and ![b](https://cdn.example.com/hero.webp) plus [doc](/media/2026/06/spec.pdf) and https://example.com/page/'
      },
      MEDIA,
      SITE
    )
    expect(imgs).toEqual([
      'https://cdn.example.com/hero.webp',
      'https://media.example.com/media/2026/06/a.png'
    ])
  })
  it('urlSitemapXml emits the image namespace + <image:image> blocks only when images exist', () => {
    const withImg = urlSitemapXml([
      { loc: 'https://example.com/post/x/', images: ['https://cdn/x.jpg'] }
    ])
    expect(withImg).toContain(
      'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    )
    expect(withImg).toContain('<image:image>')
    expect(withImg).toContain('<image:loc>https://cdn/x.jpg</image:loc>')
    const without = urlSitemapXml([{ loc: 'https://example.com/post/x/' }])
    expect(without).not.toContain('xmlns:image')
  })
})

describe('entryVideos (#367)', () => {
  const embed = (extra = '') =>
    `{% embed mediaType="video" title="The Mountain" thumbnailUrl="https://i.vimeocdn.com/x.jpg" embedUrl="https://player.vimeo.com/video/1" ${extra}/%}`

  it('extracts a video embed from the body, resolving URLs absolute + caption→description', () => {
    const e: SitemapEntry = {
      id: 'post/en/x',
      data: {},
      body: embed('caption="A classic" ')
    }
    expect(
      entryVideos(e, 'https://cdn.example', 'https://example.com')
    ).toEqual([
      {
        thumbnailLoc: 'https://i.vimeocdn.com/x.jpg',
        title: 'The Mountain',
        description: 'A classic',
        playerLoc: 'https://player.vimeo.com/video/1'
      }
    ])
  })

  it('falls back description → title when the embed has no caption (Google requires description)', () => {
    const e: SitemapEntry = { id: 'post/en/x', data: {}, body: embed() }
    expect(entryVideos(e, '', 'https://example.com')[0]?.description).toBe(
      'The Mountain'
    )
  })

  it('resolves a /media/ thumbnail through the media base', () => {
    const e: SitemapEntry = {
      id: 'post/en/x',
      data: {},
      body: `{% embed mediaType="video" title="T" thumbnailUrl="/media/2026/06/poster.jpg" embedUrl="https://p/1" /%}`
    }
    expect(
      entryVideos(e, 'https://cdn.example', 'https://example.com')[0]
        ?.thumbnailLoc
    ).toBe('https://cdn.example/media/2026/06/poster.jpg')
  })

  it('urlSitemapXml emits the video namespace + <video:video> block only when videos exist', () => {
    const withVid = urlSitemapXml([
      {
        loc: 'https://example.com/post/x/',
        videos: [
          {
            thumbnailLoc: 'https://t/x.jpg',
            title: 'T',
            description: 'D',
            playerLoc: 'https://p/1'
          }
        ]
      }
    ])
    expect(withVid).toContain(
      'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"'
    )
    expect(withVid).toContain('<video:video>')
    expect(withVid).toContain(
      '<video:thumbnail_loc>https://t/x.jpg</video:thumbnail_loc>'
    )
    expect(withVid).toContain(
      '<video:player_loc>https://p/1</video:player_loc>'
    )
    expect(withVid).toContain('<video:title>T</video:title>')
    const without = urlSitemapXml([{ loc: 'https://example.com/post/x/' }])
    expect(without).not.toContain('xmlns:video')
  })
})

describe('xml builders', () => {
  it('index is a <sitemapindex> referencing the stylesheet + sub-sitemaps', () => {
    const xml = sitemapIndexXml([
      {
        loc: 'https://example.com/post-sitemap.xml',
        lastmod: '2026-06-20T00:00:00.000Z'
      }
    ])
    expect(xml).toContain(
      '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'
    )
    expect(xml).toContain('<sitemapindex')
    expect(xml).toContain('<loc>https://example.com/post-sitemap.xml</loc>')
    expect(xml).toContain('<lastmod>2026-06-20T00:00:00.000Z</lastmod>')
  })
  it('urlset references the stylesheet', () => {
    expect(urlSitemapXml([{ loc: 'https://example.com/post/x/' }])).toContain(
      '<urlset'
    )
  })
  it('newestLastmod picks the max ISO date', () => {
    expect(
      newestLastmod([
        { loc: 'a', lastmod: '2026-01-01' },
        { loc: 'b', lastmod: '2026-06-20' }
      ])
    ).toBe('2026-06-20')
    expect(newestLastmod([{ loc: 'a' }])).toBeUndefined()
  })
})

describe('sitemapIndexEntries', () => {
  const none = { post: [], page: [], category: [], tag: [] }
  it('lists only non-empty sections, the post section one entry per shard', () => {
    const idx = sitemapIndexEntries(
      {
        ...none,
        post: [{ loc: 'https://example.com/post/a/', lastmod: '2026-06-20' }],
        tag: [{ loc: 'https://example.com/tag/x/' }]
      },
      SITE
    )
    expect(idx).toEqual([
      { loc: 'https://example.com/post-sitemap-1.xml', lastmod: '2026-06-20' },
      { loc: 'https://example.com/tag-sitemap.xml', lastmod: undefined }
    ])
  })
  it('every section empty → no entries (the route 404s instead of an invalid empty index) (#1120)', () => {
    expect(sitemapIndexEntries(none, SITE)).toEqual([])
  })
})

describe('buildRobotsTxt', () => {
  it('allows + advertises the sitemap when visible; disallows when hidden', () => {
    expect(buildRobotsTxt(true, SITE, true)).toContain(
      'Sitemap: https://example.com/sitemap.xml'
    )
    const hidden = buildRobotsTxt(false, SITE, true)
    expect(hidden).toContain('Disallow: /')
    expect(hidden).not.toContain('Sitemap:')
  })
  it('visible but no sitemap index exists → allow all, no Sitemap line pointing at a 404 (#1120)', () => {
    expect(buildRobotsTxt(true, SITE, false)).toBe('User-agent: *\nAllow: /\n')
  })
})
