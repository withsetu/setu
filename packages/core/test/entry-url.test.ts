import { describe, it, expect } from 'vitest'
import { ensureTrailingSlashPath, entryUrlPath } from '../src/url/entry-url'

// #889: the single home of Setu's trailing-slash URL policy. Every URL that refers to an entry —
// canonical, hreflang, sitemap <loc>, RSS item <link>, AND the internal navigation links the theme
// and block renderers emit — routes through this so a crawler never sees the same entry at both
// `/about` and `/about/`. `entryUrlPath` deliberately stays slash-less (it doubles as a route
// param); the slash is a display-layer concern applied by `ensureTrailingSlashPath`.
describe('ensureTrailingSlashPath (#889)', () => {
  it('appends exactly one trailing slash to a slash-less path', () => {
    expect(ensureTrailingSlashPath('/about')).toBe('/about/')
    expect(ensureTrailingSlashPath('/post/en/hello')).toBe('/post/en/hello/')
  })

  it('preserves the root and an already-slashed path (no double slash)', () => {
    expect(ensureTrailingSlashPath('/')).toBe('/')
    expect(ensureTrailingSlashPath('/about/')).toBe('/about/')
  })

  it('matches the display form of what entryUrlPath resolves for an entry', () => {
    // entryUrlPath returns the slash-less routing form; the internal-link href is that + slash.
    const path = entryUrlPath({
      collection: 'post',
      locale: 'en',
      slug: 'hello'
    })
    expect(ensureTrailingSlashPath(`/${path}`)).toBe(`/${path}/`)
    // A locale-root entry resolves to '' → the href is the bare root slash, not '//'.
    expect(ensureTrailingSlashPath('/')).toBe('/')
  })
})
