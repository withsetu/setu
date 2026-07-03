import { describe, it, expect } from 'vitest'
import { resolveSeo, type SeoPage } from '../../src/seo/resolve-seo'
import { DEFAULT_SETTINGS } from '../../src/settings/defaults'
import type { SiteSettings } from '../../src/settings/types'
import { GENERATOR_URL } from '../../src/version'

const settings = (over: Partial<SiteSettings> = {}): SiteSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
  general: { ...DEFAULT_SETTINGS.general, ...(over.general ?? {}) },
  reading: { ...DEFAULT_SETTINGS.reading, ...(over.reading ?? {}) },
  identity: { ...DEFAULT_SETTINGS.identity, ...(over.identity ?? {}) }
})

const page = (over: Partial<SeoPage> = {}): SeoPage => ({
  canonical: 'https://example.com/post/hello',
  ...over
})

const content = (
  s: ReturnType<typeof resolveSeo>,
  key: { name?: string; property?: string }
) =>
  s.meta.find((m) =>
    key.name ? m.name === key.name : m.property === key.property
  )?.content

describe('resolveSeo', () => {
  it('resolves the title through identity.titleTemplate (site = general.title)', () => {
    const s = resolveSeo(
      settings({
        general: { ...DEFAULT_SETTINGS.general, title: 'Setu Press' }
      }),
      page({ title: 'Hello' })
    )
    expect(s.title).toBe('Hello · Setu Press')
  })

  it('homepage (no page title) uses the bare site name', () => {
    const s = resolveSeo(
      settings({
        general: { ...DEFAULT_SETTINGS.general, title: 'Setu Press' }
      }),
      page({ title: '' })
    )
    expect(s.title).toBe('Setu Press')
  })

  it('honors a custom title template + separator', () => {
    const s = resolveSeo(
      settings({
        identity: {
          ...DEFAULT_SETTINGS.identity,
          titleTemplate: '{{site}} {{separator}} {{title}}',
          titleSeparator: '|'
        }
      }),
      page({ title: 'About' })
    )
    expect(s.title).toBe('Setu | About')
  })

  it('emits generator, canonical, and index,follow robots by default', () => {
    const s = resolveSeo(settings(), page({ title: 'X' }))
    expect(content(s, { name: 'generator' })).toBe(GENERATOR_URL)
    expect(s.canonical).toBe('https://example.com/post/hello')
    expect(content(s, { property: 'og:url' })).toBe(
      'https://example.com/post/hello'
    )
    expect(content(s, { name: 'robots' })).toBe('index, follow')
  })

  it('emits noindex,nofollow when the site is hidden from search', () => {
    const s = resolveSeo(
      settings({
        reading: { ...DEFAULT_SETTINGS.reading, searchEngineVisible: false }
      }),
      page()
    )
    expect(content(s, { name: 'robots' })).toBe('noindex, nofollow')
  })

  it('description falls back from page → site', () => {
    const sPage = resolveSeo(
      settings({
        general: { ...DEFAULT_SETTINGS.general, description: 'site desc' }
      }),
      page({ description: 'page desc' })
    )
    expect(content(sPage, { name: 'description' })).toBe('page desc')
    expect(content(sPage, { property: 'og:description' })).toBe('page desc')
    const sSite = resolveSeo(
      settings({
        general: { ...DEFAULT_SETTINGS.general, description: 'site desc' }
      }),
      page()
    )
    expect(content(sSite, { name: 'description' })).toBe('site desc')
  })

  it('a per-page noindex override forces noindex even when the site is search-visible (#73)', () => {
    const s = resolveSeo(settings(), page({ noindex: true }))
    expect(content(s, { name: 'robots' })).toBe('noindex, nofollow')
  })

  it('og:type defaults to website and respects article', () => {
    expect(
      content(resolveSeo(settings(), page()), { property: 'og:type' })
    ).toBe('website')
    expect(
      content(resolveSeo(settings(), page({ type: 'article' })), {
        property: 'og:type'
      })
    ).toBe('article')
  })

  it('image falls back to identity.defaultImage; twitter:card scales with image presence', () => {
    const withImg = resolveSeo(
      settings({
        identity: {
          ...DEFAULT_SETTINGS.identity,
          defaultImage: 'https://cdn/x.jpg'
        }
      }),
      page()
    )
    expect(content(withImg, { property: 'og:image' })).toBe('https://cdn/x.jpg')
    expect(content(withImg, { name: 'twitter:card' })).toBe(
      'summary_large_image'
    )
    const noImg = resolveSeo(settings(), page())
    expect(content(noImg, { property: 'og:image' })).toBeUndefined()
    expect(content(noImg, { name: 'twitter:card' })).toBe('summary')
  })

  it('normalizes the twitter handle with a single @', () => {
    const s = resolveSeo(
      settings({
        identity: { ...DEFAULT_SETTINGS.identity, twitterHandle: 'setupress' }
      }),
      page()
    )
    expect(content(s, { name: 'twitter:site' })).toBe('@setupress')
    expect(content(s, { name: 'twitter:creator' })).toBe('@setupress')
  })

  it('omits twitter:site/creator when no handle is set', () => {
    const s = resolveSeo(settings(), page())
    expect(content(s, { name: 'twitter:site' })).toBeUndefined()
  })
})
