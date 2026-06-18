import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteBaseUrl, siteUrl } from '../src/shell/site-url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('siteUrl', () => {
  it('returns the base (site home) with no ref', () => {
    expect(siteUrl()).toBe('http://localhost:4321')
  })

  it('builds a default-locale entry URL (locale dropped)', () => {
    expect(siteUrl({ collection: 'post', locale: 'en', slug: 'kitchen-sink' })).toBe(
      'http://localhost:4321/post/kitchen-sink',
    )
  })

  it('keeps a non-default locale segment', () => {
    expect(siteUrl({ collection: 'post', locale: 'fr', slug: 'bonjour' })).toBe(
      'http://localhost:4321/post/fr/bonjour',
    )
  })

  it('maps the home entry to the base (no trailing slug)', () => {
    expect(siteUrl({ collection: 'page', locale: 'en', slug: 'home' })).toBe('http://localhost:4321')
  })

  it('uses VITE_SETU_SITE when set, trimming a trailing slash', () => {
    vi.stubEnv('VITE_SETU_SITE', 'https://example.com/')
    expect(siteBaseUrl()).toBe('https://example.com/')
    expect(siteUrl({ collection: 'page', locale: 'en', slug: 'about' })).toBe('https://example.com/page/about')
  })
})
