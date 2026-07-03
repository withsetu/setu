import { describe, it, expect } from 'vitest'
import {
  resolveJsonLd,
  jsonLdScript,
  type JsonLdInput
} from '../../src/seo/json-ld'
import { DEFAULT_SETTINGS } from '../../src/settings/defaults'
import type { SiteSettings } from '../../src/settings/types'

const settings = (
  over: Partial<SiteSettings['identity']> = {},
  general: Partial<SiteSettings['general']> = {}
): SiteSettings => ({
  ...DEFAULT_SETTINGS,
  general: { ...DEFAULT_SETTINGS.general, ...general },
  identity: { ...DEFAULT_SETTINGS.identity, ...over }
})

const input = (over: Partial<JsonLdInput> = {}): JsonLdInput => ({
  siteUrl: 'https://example.com/',
  canonical: 'https://example.com/post/hello/',
  pageTitle: 'Hello',
  type: 'website',
  ...over
})

const node = (g: ReturnType<typeof resolveJsonLd>, type: string) =>
  g['@graph'].find((n) => n['@type'] === type)

describe('resolveJsonLd', () => {
  it('builds an Organization + WebSite + WebPage graph by default', () => {
    const g = resolveJsonLd(settings({}, { title: 'Setu Press' }), input())
    expect(g['@context']).toBe('https://schema.org')
    const org = node(g, 'Organization')!
    expect(org.name).toBe('Setu Press')
    expect(org['@id']).toBe('https://example.com/#organization')
    const site = node(g, 'WebSite')!
    expect(site.publisher).toEqual({
      '@id': 'https://example.com/#organization'
    })
    const webpage = node(g, 'WebPage')!
    expect(webpage.isPartOf).toEqual({ '@id': 'https://example.com/#website' })
    expect(node(g, 'Article')).toBeUndefined() // website type → no Article
  })

  it('uses a Person entity when identity.entityType is person', () => {
    const g = resolveJsonLd(
      settings({ entityType: 'person', name: 'Ada' }),
      input()
    )
    expect(node(g, 'Person')!['@id']).toBe('https://example.com/#person')
    expect(node(g, 'Organization')).toBeUndefined()
  })

  it('includes sameAs + Organization logo when present', () => {
    const g = resolveJsonLd(
      settings({ socialProfiles: ['https://github.com/x'] }),
      input({ logo: 'https://example.com/logo.png' })
    )
    const org = node(g, 'Organization')!
    expect(org.sameAs).toEqual(['https://github.com/x'])
    expect((org.logo as { url: string }).url).toBe(
      'https://example.com/logo.png'
    )
  })

  it('adds an Article node (with dates, image ref, author/publisher) for posts', () => {
    const g = resolveJsonLd(
      settings(),
      input({
        type: 'article',
        image: 'https://example.com/i.jpg',
        datePublished: '2026-06-20T00:00:00.000Z',
        dateModified: '2026-06-21T00:00:00.000Z'
      })
    )
    const art = node(g, 'Article')!
    expect(art.headline).toBe('Hello')
    expect(art.datePublished).toBe('2026-06-20T00:00:00.000Z')
    expect(art.dateModified).toBe('2026-06-21T00:00:00.000Z')
    expect(art.mainEntityOfPage).toEqual({
      '@id': 'https://example.com/post/hello/#webpage'
    })
    expect(art.author).toEqual({ '@id': 'https://example.com/#organization' })
    expect(art.image).toEqual({
      '@id': 'https://example.com/post/hello/#primaryimage'
    })
    // the primary image object is present and shared by @id
    expect(node(g, 'ImageObject')!['@id']).toBe(
      'https://example.com/post/hello/#primaryimage'
    )
  })

  it('WebPage name falls back to the site name on the homepage (empty pageTitle)', () => {
    const g = resolveJsonLd(
      settings({}, { title: 'Setu Press' }),
      input({ pageTitle: '', canonical: 'https://example.com/' })
    )
    expect(node(g, 'WebPage')!.name).toBe('Setu Press')
  })
})

describe('jsonLdScript', () => {
  it('escapes < so a value cannot break out of the script tag', () => {
    const g = resolveJsonLd(
      settings({}, { description: 'evil </script><script>alert(1)' }),
      input()
    )
    const s = jsonLdScript(g)
    expect(s).not.toContain('</script>')
    expect(s).toContain('\\u003c/script>')
    // still valid JSON after unescaping
    expect(() => JSON.parse(s.replace(/\\u003c/g, '<'))).not.toThrow()
  })
})
