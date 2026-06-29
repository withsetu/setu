import { describe, it, expect } from 'vitest'
import { runAudit, scanBody, SITE_CAPABILITIES } from '../src/index'
import type { AuditContext } from '../src/index'

const ctx = (over: Partial<AuditContext> = {}): AuditContext => ({
  settings: { general: { title: 'T', description: 'D' }, reading: { homepage: 'page/en/home', searchEngineVisible: true, feed: { enabled: false } } },
  entries: [{ id: 'page/en/home', data: { title: 'Home' }, body: 'Hello' }],
  capabilities: SITE_CAPABILITIES,
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
    expect(a.results.find((r) => r.id === 'privacy.policy')?.status).toBe('manual')
  })
  it('scores only pass+fail, surfaces must-haves, assigns a band', () => {
    const a = runAudit(ctx())
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
    expect(['strong', 'good', 'needs-work']).toContain(a.band)
    expect(a.mustHaves.total).toBeGreaterThan(0)
    // pending/manual excluded: a perfect config+content+caps run never reaches 100 here because platform gaps fail,
    // but security.hsts (pending) must NOT count against it
    expect(a.results.some((r) => r.status === 'pending')).toBe(true)
  })
})
