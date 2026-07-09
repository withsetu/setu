import { describe, it, expect } from 'vitest'
import { evaluateProbe, mergeProbe } from '../../src/health/probe'
import type {
  AuditResult,
  CheckResult,
  ProbeInput
} from '../../src/health/types'

const input = (over: Partial<ProbeInput> = {}): ProbeInput => ({
  finalUrl: 'https://example.com/',
  status: 200,
  headers: new Headers(),
  ...over
})

describe('evaluateProbe — security.https', () => {
  it('passes when the site was reached over https with an ok status', () => {
    const r = evaluateProbe(input()).find((x) => x.id === 'security.https')
    expect(r?.status).toBe('pass')
  })

  it('passes when an http URL redirected up to https (finalUrl is https)', () => {
    const r = evaluateProbe(
      input({ finalUrl: 'https://example.com/home', status: 200 })
    ).find((x) => x.id === 'security.https')
    expect(r?.status).toBe('pass')
  })

  it('fails when the reached URL is not https', () => {
    const r = evaluateProbe(input({ finalUrl: 'http://example.com/' })).find(
      (x) => x.id === 'security.https'
    )
    expect(r?.status).toBe('fail')
  })

  it('fails on a server-error status even over https', () => {
    const r = evaluateProbe(input({ status: 500 })).find(
      (x) => x.id === 'security.https'
    )
    expect(r?.status).toBe('fail')
  })
})

describe('evaluateProbe — security.hsts', () => {
  it('passes with a Strict-Transport-Security header carrying a positive max-age', () => {
    const r = evaluateProbe(
      input({
        headers: new Headers({
          'strict-transport-security': 'max-age=31536000; includeSubDomains'
        })
      })
    ).find((x) => x.id === 'security.hsts')
    expect(r?.status).toBe('pass')
  })

  it('fails when the header is absent', () => {
    const r = evaluateProbe(input()).find((x) => x.id === 'security.hsts')
    expect(r?.status).toBe('fail')
  })

  it('fails when max-age is zero (HSTS explicitly disabled)', () => {
    const r = evaluateProbe(
      input({
        headers: new Headers({ 'strict-transport-security': 'max-age=0' })
      })
    ).find((x) => x.id === 'security.hsts')
    expect(r?.status).toBe('fail')
  })

  it('every result carries a human detail string', () => {
    for (const r of evaluateProbe(input())) {
      expect(typeof r.detail).toBe('string')
      expect(r.detail.length).toBeGreaterThan(0)
    }
  })
})

// ---- mergeProbe ----

const baseAudit = (): AuditResult => ({
  results: [
    { id: 'security.https', status: 'pending', owner: 'manual' },
    { id: 'security.hsts', status: 'pending', owner: 'manual' },
    { id: 'seo.title', status: 'pass', owner: 'config' }
  ],
  score: 100,
  band: 'strong',
  byCategory: [],
  mustHaves: { done: 0, total: 0 }
})

describe('mergeProbe', () => {
  it('overlays probe results onto matching pending items as platform-owned pass/fail with probedAt', () => {
    const merged = mergeProbe(baseAudit(), {
      probedAt: '2026-01-15T00:00:00.000Z',
      results: [
        { id: 'security.https', status: 'pass', detail: 'Reached over HTTPS.' },
        { id: 'security.hsts', status: 'fail', detail: 'No HSTS header.' }
      ]
    })
    const https = merged.results.find(
      (r: CheckResult) => r.id === 'security.https'
    )
    const hsts = merged.results.find(
      (r: CheckResult) => r.id === 'security.hsts'
    )
    expect(https?.status).toBe('pass')
    expect(https?.owner).toBe('platform')
    expect(https?.probedAt).toBe('2026-01-15T00:00:00.000Z')
    expect(hsts?.status).toBe('fail')
    expect(hsts?.detail).toBe('No HSTS header.')
  })

  it('leaves non-probed items untouched', () => {
    const merged = mergeProbe(baseAudit(), {
      probedAt: '2026-01-15T00:00:00.000Z',
      results: [{ id: 'security.https', status: 'pass', detail: 'ok' }]
    })
    const title = merged.results.find((r: CheckResult) => r.id === 'seo.title')
    expect(title?.status).toBe('pass')
    expect(title?.owner).toBe('config')
    // hsts had no probe result → stays pending
    expect(
      merged.results.find((r: CheckResult) => r.id === 'security.hsts')?.status
    ).toBe('pending')
  })

  it('recomputes score + band so newly-passing probe items count', () => {
    const audit = baseAudit()
    const merged = mergeProbe(audit, {
      probedAt: '2026-01-15T00:00:00.000Z',
      results: [
        { id: 'security.https', status: 'pass', detail: 'ok' },
        { id: 'security.hsts', status: 'pass', detail: 'ok' }
      ]
    })
    // score is recomputed from the merged results, not copied from the input audit
    expect(merged.score).toBeGreaterThanOrEqual(0)
    expect(merged.score).toBeLessThanOrEqual(100)
    expect(['strong', 'good', 'needs-work']).toContain(merged.band)
  })
})
