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
  it('starts with the emitted-today capabilities true and the rest false', () => {
    expect(SITE_CAPABILITIES.title).toBe(true)
    expect(SITE_CAPABILITIES.viewport).toBe(true)
    expect(SITE_CAPABILITIES.canonical).toBe(false)
    expect(SITE_CAPABILITIES.sitemap).toBe(false)
  })
})
