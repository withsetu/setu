import { describe, it, expect } from 'vitest'
import {
  xmlEscape,
  channelExtras,
  mediaItemUrl,
  toRssItem
} from '../src/lib/rss-xml'
import type { FeedItem } from '../src/lib/feed'

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  title: 'T',
  link: '/post/x',
  pubDate: new Date('2024-01-02T03:04:05Z'),
  description: 'D',
  categories: [],
  ...over
})

describe('xmlEscape', () => {
  it('escapes the five XML entities', () => {
    expect(xmlEscape(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f'
    )
  })
})

describe('channelExtras', () => {
  it('emits language, generator (with version), and atom:self', () => {
    const out = channelExtras({
      locale: 'en',
      selfUrl: 'https://x.dev/rss.xml',
      lastBuild: null
    })
    expect(out).toContain('<language>en</language>')
    expect(out).toContain('<generator>https://setu.build/?v=1.0</generator>')
    expect(out).toContain(
      '<atom:link href="https://x.dev/rss.xml" rel="self" type="application/rss+xml" />'
    )
  })
  it('includes lastBuildDate when a date is given, omits it when null', () => {
    const withDate = channelExtras({
      locale: 'fr',
      selfUrl: 'https://x.dev/fr/rss.xml',
      lastBuild: new Date('2024-01-02T03:04:05Z')
    })
    expect(withDate).toContain('<lastBuildDate>')
    expect(withDate).toMatch(/<lastBuildDate>.*2024.*<\/lastBuildDate>/)
    const withoutDate = channelExtras({
      locale: 'en',
      selfUrl: 'https://x.dev/rss.xml',
      lastBuild: null
    })
    expect(withoutDate).not.toContain('<lastBuildDate>')
  })
  it('escapes interpolated values', () => {
    const out = channelExtras({
      locale: 'en',
      selfUrl: 'https://x.dev/rss.xml?a=1&b=2',
      lastBuild: null
    })
    expect(out).toContain('a=1&amp;b=2')
  })
})

describe('mediaItemUrl', () => {
  const site = 'https://x.dev/'
  it('passes through an absolute http(s) image (e.g. a seeded external thumbnail)', () => {
    expect(mediaItemUrl('https://img.cdn/x.jpg', '/media-base', site)).toBe(
      'https://img.cdn/x.jpg'
    )
  })
  it('resolves a /media path against the media base and site to an absolute URL', () => {
    expect(
      mediaItemUrl('/media/2026/06/x.jpg', 'https://cdn.x.dev', site)
    ).toBe('https://cdn.x.dev/media/2026/06/x.jpg')
  })
  it('absolutizes a relative media base against the site origin', () => {
    expect(mediaItemUrl('/media/2026/06/x.jpg', '', site)).toBe(
      'https://x.dev/media/2026/06/x.jpg'
    )
  })
  it('returns undefined for an empty image', () => {
    expect(mediaItemUrl(undefined, '/media-base', site)).toBeUndefined()
    expect(mediaItemUrl('', '/media-base', site)).toBeUndefined()
  })
})

describe('toRssItem', () => {
  it('emits a media:content element with the absolute URL + a mime type from the extension', () => {
    const out = toRssItem(
      item({ image: '/media/2026/06/x.jpg' }),
      'https://x.dev/media/2026/06/x.jpg'
    )
    expect(out.customData).toContain(
      '<media:content url="https://x.dev/media/2026/06/x.jpg"'
    )
    expect(out.customData).toContain('medium="image"')
    expect(out.customData).toContain('type="image/jpeg"')
  })
  it('omits media:content (no customData) when there is no image', () => {
    expect(toRssItem(item(), undefined).customData).toBeUndefined()
  })
  it('passes categories through, and omits them when empty', () => {
    expect(
      toRssItem(item({ categories: ['A', 'b'] }), undefined).categories
    ).toEqual(['A', 'b'])
    expect(toRssItem(item(), undefined).categories).toBeUndefined()
  })
  it('escapes the media url', () => {
    const out = toRssItem(
      item({ image: '/m/x.png' }),
      'https://x.dev/m/a&b.png'
    )
    expect(out.customData).toContain('a&amp;b.png')
  })
})
