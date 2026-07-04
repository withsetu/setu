import { describe, it, expect } from 'vitest'
import { entryUrlPath, DEFAULT_LOCALE } from '../../src/index'

describe('entryUrlPath', () => {
  it('drops the default-locale segment', () => {
    expect(
      entryUrlPath({ collection: 'post', locale: 'en', slug: 'kitchen-sink' })
    ).toBe('post/kitchen-sink')
  })
  it('non-default locale is a LEADING prefix (changed by #251; was post/fr/…)', () => {
    expect(
      entryUrlPath({ collection: 'post', locale: 'fr', slug: 'bonjour' })
    ).toBe('fr/post/bonjour')
  })
  it('maps the home entry (page/<default>/home) to the site root ("")', () => {
    expect(
      entryUrlPath({ collection: 'page', locale: 'en', slug: 'home' })
    ).toBe('')
  })
  it('a non-default-locale home is NOT the root', () => {
    expect(
      entryUrlPath({ collection: 'page', locale: 'fr', slug: 'home' })
    ).toBe('fr/page/home')
  })
  it('honors a pattern config', () => {
    expect(
      entryUrlPath(
        {
          collection: 'post',
          locale: 'en',
          slug: 'hi',
          date: Date.UTC(2026, 5, 20)
        },
        { pattern: 'blog/:year/:slug', uncategorized: 'uncategorized' }
      )
    ).toBe('blog/2026/hi')
  })
  it('exports the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })
})
