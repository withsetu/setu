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
  it('a non-default-locale home is that locale’s root (#660)', () => {
    // Was 'fr/page/home', so /fr/ 404'd on every translated site.
    expect(
      entryUrlPath({ collection: 'page', locale: 'fr', slug: 'home' })
    ).toBe('fr')
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

/** #660 — the homepage identity was read in two places with different rules:
 *  `entry-url.ts` hardcoded `page/en/home` while `reading.homepage` is an admin-editable
 *  setting that `apps/site/src/lib/permalinks.ts` honours. Changing the setting left the
 *  old page owning `/` while the admin "View" link and theme fallbacks pointed elsewhere. */
describe('entryUrlPath homepage identity (#660)', () => {
  const cfg = undefined

  it('the configured homepage owns the root of its locale', () => {
    expect(
      entryUrlPath(
        { collection: 'page', locale: 'en', slug: 'about' },
        cfg,
        'page/en/about'
      )
    ).toBe('')
  })

  it('a configured homepage in another locale owns that locale’s root', () => {
    expect(
      entryUrlPath(
        { collection: 'page', locale: 'fr', slug: 'accueil' },
        cfg,
        'page/fr/accueil'
      )
    ).toBe('fr')
  })

  it('once a homepage is configured, page/en/home is an ordinary page again', () => {
    expect(
      entryUrlPath(
        { collection: 'page', locale: 'en', slug: 'home' },
        cfg,
        'page/en/about'
      )
    ).toBe('page/home')
  })

  it('other locales keep their page/<locale>/home convention', () => {
    expect(
      entryUrlPath(
        { collection: 'page', locale: 'fr', slug: 'home' },
        cfg,
        'page/en/about'
      )
    ).toBe('fr')
  })

  it('an unrelated entry is unaffected by the setting', () => {
    expect(
      entryUrlPath(
        { collection: 'post', locale: 'en', slug: 'hi' },
        cfg,
        'page/en/about'
      )
    ).toBe('post/hi')
  })

  it('no homepageId → the page/<locale>/home convention, as before', () => {
    expect(
      entryUrlPath({ collection: 'page', locale: 'de', slug: 'home' })
    ).toBe('de')
    expect(
      entryUrlPath({ collection: 'page', locale: 'en', slug: 'home' })
    ).toBe('')
  })
})
