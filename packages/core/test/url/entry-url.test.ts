import { describe, it, expect } from 'vitest'
import { entryUrlPath, DEFAULT_LOCALE } from '../../src/index'

describe('entryUrlPath', () => {
  it('drops the default-locale segment', () => {
    expect(entryUrlPath({ collection: 'post', locale: 'en', slug: 'kitchen-sink' })).toBe('post/kitchen-sink')
  })

  it('keeps a non-default-locale segment', () => {
    expect(entryUrlPath({ collection: 'post', locale: 'fr', slug: 'bonjour' })).toBe('post/fr/bonjour')
  })

  it('maps the home entry (page/<default>/home) to the site root ("")', () => {
    expect(entryUrlPath({ collection: 'page', locale: 'en', slug: 'home' })).toBe('')
  })

  it('a non-default-locale home is NOT the root (it is a normal page)', () => {
    expect(entryUrlPath({ collection: 'page', locale: 'fr', slug: 'home' })).toBe('page/fr/home')
  })

  it('default-locale page drops the locale', () => {
    expect(entryUrlPath({ collection: 'page', locale: 'en', slug: 'about' })).toBe('page/about')
  })

  it('exports the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })
})
