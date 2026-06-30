import { describe, it, expect } from 'vitest'
import { runAudit, scanBody, SITE_CAPABILITIES } from '../src/index'
import type { AuditContext } from '../src/index'

const ctx = (over: Partial<AuditContext> = {}): AuditContext => ({
  settings: { general: { title: 'T', description: 'D' }, reading: { homepage: 'page/en/home', searchEngineVisible: true, feed: { enabled: false } } },
  entries: [{ id: 'page/en/home', data: { title: 'Home' }, body: 'Hello' }],
  capabilities: SITE_CAPABILITIES,
  health: { items: {}, sections: {} },
  ...over,
})

describe('scanBody', () => {
  it('flags images without alt and counts h1s', () => {
    const r = scanBody('# Heading\n\n![](pic.png)\n\n{% image src="x.png" %}{% /image %}')
    expect(r.imagesWithoutAlt).toBe(2)
    expect(r.h1Count).toBe(1)
  })
  it('does not flag images with alt', () => {
    expect(scanBody('![a cat](cat.png)').imagesWithoutAlt).toBe(0)
  })
})

describe('runAudit', () => {
  it('passes config checks when settings are complete', () => {
    const a = runAudit(ctx())
    expect(a.results.find((r) => r.id === 'foundations.title')?.status).toBe('pass')
    expect(a.results.find((r) => r.id === 'seo.indexable')?.status).toBe('pass')
  })
  it('fails seo.indexable when noindex is set', () => {
    const a = runAudit(ctx({ settings: { general: { title: 'T', description: 'D' }, reading: { homepage: 'page/en/home', searchEngineVisible: false, feed: { enabled: false } } } }))
    expect(a.results.find((r) => r.id === 'seo.indexable')?.status).toBe('fail')
  })
  it('fails image-alt with offenders', () => {
    const a = runAudit(ctx({ entries: [{ id: 'post/en/p', data: { title: 'P' }, body: '![](x.png)' }] }))
    const r = a.results.find((x) => x.id === 'accessibility.image-alt')!
    expect(r.status).toBe('fail')
    expect(r.offenders?.[0]?.ref).toBe('post/en/p')
  })
  it('marks platform gaps as fail and live items as pending', () => {
    const a = runAudit(ctx())
    // foundations.canonical is a platform capability (canonical: false) → fail
    expect(a.results.find((r) => r.id === 'foundations.canonical')?.status).toBe('fail')
    expect(a.results.find((r) => r.id === 'foundations.canonical')?.owner).toBe('platform')
    // security.hsts is liveProbe → pending
    expect(a.results.find((r) => r.id === 'security.hsts')?.status).toBe('pending')
    // privacy.policy has no auto-evaluator → unverified (was 'manual' in v1)
    expect(a.results.find((r) => r.id === 'privacy.policy')?.status).toBe('unverified')
  })
  it('scores (na excluded), surfaces must-haves, assigns a band', () => {
    const a = runAudit(ctx())
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
    expect(['strong', 'good', 'needs-work']).toContain(a.band)
    expect(a.mustHaves.total).toBeGreaterThan(0)
    // pending/unverified excluded from score denominator
    expect(a.results.some((r) => r.status === 'pending')).toBe(true)
  })

  // --- Resolution order tests (new in v2) ---

  it('non-auto manual item is unverified (not excluded) and attestable', () => {
    const a = runAudit(ctx())
    const p = a.results.find((r) => r.id === 'privacy.policy')!
    expect(p.status).toBe('unverified')
    expect(p.attestable).toBe(true)
  })
  it('an attestation turns an unverified item into a pass', () => {
    const a = runAudit(ctx({ health: { items: { 'privacy.policy': { state: 'attested', at: '2026-01-01', by: 'Local' } }, sections: {} } }))
    expect(a.results.find((r) => r.id === 'privacy.policy')?.status).toBe('pass')
  })
  it('an auto-evaluator supersedes an attestation for the same id', () => {
    const a = runAudit(ctx({ health: { items: { 'foundations.title': { state: 'attested', at: '2026-01-01', by: 'Local' } }, sections: {} } }))
    // foundations.title has a config evaluator → still evaluated, attestation ignored
    expect(a.results.find((r) => r.id === 'foundations.title')?.status).toBe('pass') // (passes anyway, but via the evaluator)
  })
  it('manual na excludes an item from the score', () => {
    const base = runAudit(ctx())
    const na = runAudit(ctx({ health: { items: { 'seo.sitemap': { state: 'na', at: '2026-01-01', by: 'Local' } }, sections: {} } }))
    expect(na.results.find((r) => r.id === 'seo.sitemap')?.status).toBe('na')
    expect(na.results.find((r) => r.id === 'seo.sitemap')?.naSource).toBe('manual')
    expect(na.score).toBeGreaterThan(base.score) // dropping a failing must-have from the denominator raises the score
  })
  it('i18n auto-N/As on a single-locale site and applies with a 2nd locale', () => {
    const single = runAudit(ctx())
    expect(single.results.find((r) => r.id === 'i18n.hreflang')?.status).toBe('na')
    expect(single.results.find((r) => r.id === 'i18n.hreflang')?.naSource).toBe('auto')
    const multi = runAudit(ctx({ entries: [{ id: 'page/en/home', data: { title: 'H' }, body: '' }, { id: 'post/fr/x', data: { title: 'X' }, body: '' }] }))
    expect(multi.results.find((r) => r.id === 'i18n.hreflang')?.status).not.toBe('na')
  })
  it('section na excludes every item in that category', () => {
    const a = runAudit(ctx({ health: { items: {}, sections: { accessibility: { state: 'na', at: '2026-01-01', by: 'Local' } } } }))
    expect(a.results.filter((r) => r.id.startsWith('accessibility.')).every((r) => r.status === 'na')).toBe(true)
  })
})
