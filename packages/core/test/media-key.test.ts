import { describe, it, expect } from 'vitest'
import {
  mediaSlug,
  mediaKeyOf,
  originalKey,
  variantKey,
  manifestKey
} from '../src/index'

describe('mediaSlug', () => {
  it('lowercases, strips the extension, and dash-joins words', () => {
    expect(mediaSlug('My Cat Photo.JPG')).toBe('my-cat-photo')
  })
  it('collapses punctuation/unicode and trims dashes', () => {
    expect(mediaSlug('  Héllo — Wörld!!.png')).toBe('hello-world')
  })
  it('falls back to "file" for an empty/exotic name', () => {
    expect(mediaSlug('©.png')).toBe('file')
    expect(mediaSlug('.gitignore')).toBe('file')
  })
  it('caps very long slugs at 60 chars (no trailing dash)', () => {
    const s = mediaSlug('a'.repeat(200) + '.jpg')
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.endsWith('-')).toBe(false)
  })
  it('keeps an extensionless filename', () => {
    expect(mediaSlug('Makefile')).toBe('makefile')
    expect(mediaSlug('README')).toBe('readme')
  })
})

describe('key assembly', () => {
  it('mediaKeyOf zero-pads the month', () => {
    expect(mediaKeyOf(2026, 6, 'my-cat-photo')).toBe('2026/06/my-cat-photo')
    expect(mediaKeyOf(2026, 12, 'x')).toBe('2026/12/x')
  })
  it('builds original/variant/manifest keys', () => {
    const k = '2026/06/my-cat-photo'
    expect(originalKey(k, 'jpg')).toBe('2026/06/my-cat-photo.jpg')
    expect(variantKey(k, 800, 'webp')).toBe('2026/06/my-cat-photo-800w.webp')
    expect(manifestKey(k)).toBe('2026/06/my-cat-photo.manifest.json')
  })
})
