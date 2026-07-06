import { describe, it, expect } from 'vitest'
import { localeAlternates } from '../../src/url/locale-alternates'

describe('localeAlternates', () => {
  it('returns the translation set (same collection+slug across locales), default locale first', () => {
    const all = ['post/en/bonjour', 'post/fr/bonjour', 'post/en/other']
    expect(localeAlternates('post/fr/bonjour', all)).toEqual([
      { locale: 'en', id: 'post/en/bonjour' },
      { locale: 'fr', id: 'post/fr/bonjour' }
    ])
  })

  it('includes the entry itself in its own alternate set', () => {
    const all = ['post/en/bonjour', 'post/fr/bonjour']
    const out = localeAlternates('post/en/bonjour', all)
    expect(out.map((a) => a.id)).toContain('post/en/bonjour')
  })

  it('returns [] for a single-locale entry (no translation → no alternates to declare)', () => {
    const all = ['post/en/solo', 'post/en/other', 'post/fr/bonjour']
    expect(localeAlternates('post/en/solo', all)).toEqual([])
  })

  it('does not match the same slug across different collections', () => {
    const all = ['post/en/about', 'page/fr/about']
    expect(localeAlternates('post/en/about', all)).toEqual([])
  })

  it('matches slugs that contain slashes', () => {
    const all = ['post/en/2026/hello', 'post/fr/2026/hello']
    expect(
      localeAlternates('post/en/2026/hello', all).map((a) => a.locale)
    ).toEqual(['en', 'fr'])
  })

  it('sorts non-default locales alphabetically after the default', () => {
    const all = ['post/de/x', 'post/fr/x', 'post/en/x']
    expect(localeAlternates('post/en/x', all).map((a) => a.locale)).toEqual([
      'en',
      'de',
      'fr'
    ])
  })

  it('dedupes to one id per locale', () => {
    const all = ['post/en/x', 'post/fr/x', 'post/fr/x']
    expect(localeAlternates('post/en/x', all)).toHaveLength(2)
  })

  it('returns [] for a malformed id (no slug segment)', () => {
    expect(localeAlternates('post/en', ['post/en', 'post/fr'])).toEqual([])
  })
})
