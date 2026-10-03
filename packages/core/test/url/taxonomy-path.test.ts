import { describe, it, expect } from 'vitest'
import {
  taxonomyArchivePath,
  taxonomyTermLocales,
  type PostRow
} from '../../src/index'

describe('taxonomyArchivePath (#1120)', () => {
  it('builds the trailing-slash archive path for a plain slug', () => {
    expect(taxonomyArchivePath('tag', 'astro')).toBe('/tag/astro/')
    expect(taxonomyArchivePath('category', 'recipes')).toBe(
      '/category/recipes/'
    )
  })

  it('percent-encodes a space so the path is a valid URL (not a literal space)', () => {
    expect(taxonomyArchivePath('tag', 'web dev')).toBe('/tag/web%20dev/')
  })

  it('keeps Astro’s own #/? encoding (route generator sanitizeParams) so the path is not truncated', () => {
    expect(taxonomyArchivePath('tag', 'c#4')).toBe('/tag/c%234/')
    expect(taxonomyArchivePath('tag', 'a?b')).toBe('/tag/a%3Fb/')
  })

  it('UTF-8 percent-encodes non-ASCII and other URL-unsafe characters', () => {
    expect(taxonomyArchivePath('tag', 'café')).toBe('/tag/caf%C3%A9/')
    expect(taxonomyArchivePath('tag', 'x"y')).toBe('/tag/x%22y/')
  })

  it('Unicode-normalizes (NFC) first, as Astro does, so composed and decomposed forms agree', () => {
    const decomposed = 'cafe' + String.fromCodePoint(0x0301) // e + combining acute
    const composed = 'caf' + String.fromCodePoint(0x00e9) // é
    expect(taxonomyArchivePath('tag', decomposed)).toBe(
      taxonomyArchivePath('tag', composed)
    )
    expect(taxonomyArchivePath('tag', decomposed)).toBe('/tag/caf%C3%A9/')
  })

  it('equals what the WHATWG URL parser serializes for the Astro route path (what canonical uses)', () => {
    for (const slug of ['web dev', 'c#4', 'café', 'x"y', 'plain'])
      expect(
        new URL(taxonomyArchivePath('tag', slug), 'https://example.com')
          .pathname
      ).toBe(taxonomyArchivePath('tag', slug))
  })
})

describe('taxonomyArchivePath locale (#1114)', () => {
  it('keeps the default locale unprefixed, explicitly or by default', () => {
    expect(taxonomyArchivePath('tag', 'astro', 'en')).toBe('/tag/astro/')
    expect(taxonomyArchivePath('tag', 'astro')).toBe('/tag/astro/')
  })
  it('prefixes every other locale', () => {
    expect(taxonomyArchivePath('tag', 'voyage', 'fr')).toBe('/fr/tag/voyage/')
    expect(taxonomyArchivePath('category', 'recipes', 'fr')).toBe(
      '/fr/category/recipes/'
    )
  })
  it('applies the same slug encoding under a locale prefix', () => {
    expect(taxonomyArchivePath('tag', 'c#4', 'fr')).toBe('/fr/tag/c%234/')
    expect(taxonomyArchivePath('tag', 'web dev', 'fr')).toBe(
      '/fr/tag/web%20dev/'
    )
  })
})

const row = (
  locale: string,
  tags: string[],
  over: Partial<PostRow> = {}
): PostRow => ({
  id: `post/${locale}/${tags.join('-')}`,
  collection: 'post',
  locale,
  slug: tags.join('-'),
  title: '',
  date: null,
  tags,
  categories: [],
  ...over
})

describe('taxonomyTermLocales (#1114)', () => {
  it('maps each term to the locales with a post carrying it (default first)', () => {
    const m = taxonomyTermLocales(
      [
        row('fr', ['astro', 'voyage']),
        row('en', ['astro']),
        row('de', ['astro'])
      ],
      (r) => r.tags
    )
    expect(m.get('astro')).toEqual(['en', 'de', 'fr'])
    expect(m.get('voyage')).toEqual(['fr'])
  })
  it('ignores unpublished posts (published:false is the only hidden signal)', () => {
    const m = taxonomyTermLocales(
      [row('fr', ['secret'], { published: false })],
      (r) => r.tags
    )
    expect(m.has('secret')).toBe(false)
  })
  it('ignores non-post rows and empty terms', () => {
    const m = taxonomyTermLocales(
      [row('en', ['x'], { collection: 'page' }), row('en', [''])],
      (r) => r.tags
    )
    expect(m.size).toBe(0)
  })
})
