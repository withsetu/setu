import { describe, it, expect } from 'vitest'
import { RUBRIC, SITE_CAPABILITIES } from '../src/index'

describe('health rubric', () => {
  it('has unique ids and valid severities/categories', () => {
    const ids = RUBRIC.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sev = new Set(['required', 'recommended', 'optional', 'avoid'])
    const cat = new Set(['foundations','seo','accessibility','security','well-known','agent-readiness','performance','privacy','resilience','i18n'])
    for (const r of RUBRIC) {
      expect(sev.has(r.severity)).toBe(true)
      expect(cat.has(r.category)).toBe(true)
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.guidance.length).toBeGreaterThan(0)
      expect(r.url.startsWith('https://specification.website')).toBe(true)
    }
  })
  it('reflects the emitted-today capabilities true and the not-yet-built ones false', () => {
    expect(SITE_CAPABILITIES.title).toBe(true)
    expect(SITE_CAPABILITIES.viewport).toBe(true)
    // SEO module B (#71) emits these in the head:
    expect(SITE_CAPABILITIES.canonical).toBe(true)
    expect(SITE_CAPABILITIES.openGraph).toBe(true)
    expect(SITE_CAPABILITIES.twitterCard).toBe(true)
    // SEO module C (#72) emits JSON-LD structured data:
    expect(SITE_CAPABILITIES.jsonLd).toBe(true)
    // SEO modules F/G (#225/#226) emit sitemap.xml + robots.txt:
    expect(SITE_CAPABILITIES.sitemap).toBe(true)
    expect(SITE_CAPABILITIES.robotsTxt).toBe(true)
    // still not built:
    expect(SITE_CAPABILITIES.hreflang).toBe(false)
  })
})
