import { describe, it, expect } from 'vitest'
import rss from '@astrojs/rss'
import { buildFeed } from '../src/lib/rss-xml'
import type { FeedItem } from '../src/lib/feed'

const item = (over: Partial<FeedItem>): FeedItem => ({
  title: 'T',
  link: '/post/x',
  pubDate: new Date('2024-01-02T03:04:05Z'),
  description: 'D',
  categories: [],
  ...over,
})

/** Render the real serialized feed XML and assert the validator furniture is present. */
async function renderFeed(over: Partial<Parameters<typeof buildFeed>[0]> = {}): Promise<string> {
  const res = await rss(
    buildFeed({
      title: 'My Site',
      description: 'desc',
      site: 'https://example.dev/',
      locale: 'en',
      feedPath: 'rss.xml',
      items: [
        item({ title: 'Post One', link: '/post/one', categories: ['Recipes', 'dinner'], image: '/media/2026/06/one.jpg' }),
        item({ title: 'Post Two', link: '/post/two', pubDate: new Date('2024-02-09T00:00:00Z') }),
      ],
      ...over,
    }),
  )
  return await res.text()
}

describe('rss output (serialized)', () => {
  it('declares the atom + media namespaces on the root', async () => {
    const xml = await renderFeed()
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"')
    expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"')
  })

  it('emits language, generator (with version), atom:self and lastBuildDate', async () => {
    const xml = await renderFeed()
    expect(xml).toContain('<language>en</language>')
    expect(xml).toContain('<generator>https://setu.build/?v=1.0</generator>')
    expect(xml).toContain('<atom:link href="https://example.dev/rss.xml" rel="self" type="application/rss+xml"')
    // newest of the two items
    expect(xml).toContain('<lastBuildDate>Fri, 09 Feb 2024 00:00:00 GMT</lastBuildDate>')
  })

  it('emits per-item categories and a media:content for the featured image', async () => {
    const xml = await renderFeed()
    expect(xml).toContain('<category>Recipes</category>')
    expect(xml).toContain('<category>dinner</category>')
    // The media host depends on env (dev media server vs prod base), so assert the absolute
    // path + attributes rather than the host. Exact-URL passthrough is covered below.
    expect(xml).toMatch(/<media:content url="https?:\/\/[^"]*\/media\/2026\/06\/one\.jpg" medium="image" type="image\/jpeg"/)
    // the imageless item carries no media:content
    expect(xml.match(/<media:content/g)?.length).toBe(1)
  })

  it('passes an external featured-image URL through unchanged (e.g. seeded recipe thumbnails)', async () => {
    const xml = await renderFeed({
      items: [item({ link: '/post/ext', image: 'https://cdn.example.com/thumb.png' })],
    })
    expect(xml).toContain('<media:content url="https://cdn.example.com/thumb.png" medium="image" type="image/png"')
  })

  it('uses the locale for a per-locale feed', async () => {
    const xml = await renderFeed({ locale: 'fr', feedPath: 'fr/rss.xml', title: 'My Site (FR)' })
    expect(xml).toContain('<language>fr</language>')
    expect(xml).toContain('<atom:link href="https://example.dev/fr/rss.xml" rel="self"')
  })

  it('builds a correct self-link even when site lacks a trailing slash', async () => {
    const xml = await renderFeed({ site: 'https://example.dev', feedPath: 'fr/rss.xml', locale: 'fr' })
    expect(xml).toContain('<atom:link href="https://example.dev/fr/rss.xml" rel="self"')
  })
})
