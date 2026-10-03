import { describe, it, expect } from 'vitest'
import { taxonomyArchivePath } from '../../src/index'

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
