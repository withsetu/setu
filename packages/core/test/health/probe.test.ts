import { describe, it, expect } from 'vitest'
import {
  evaluateProbe,
  mergeProbe,
  PROBE_ITEM_IDS
} from '../../src/health/probe'
import { RUBRIC } from '../../src/health/rubric'
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

// --- #659: the evaluator set and the rubric's liveProbe set must be the same set ----

/** Three of the five `liveProbe: true` rubric items had no evaluator. `run-audit.ts`
 *  resolved them to `pending`, which `scoreOf` excludes from the denominator FOREVER —
 *  and because `security.content-type-options` is `severity: 'required'`, `mustHaves.total`
 *  counted it while `mustHaves.done` never could. The Must-haves counter could not reach
 *  100% on a correct site. This test is the drift alarm: modelled on SCAN_ITEM_IDS /
 *  needsScan, which is the same shape done correctly. */
describe('live-probe coverage (#659)', () => {
  it('every liveProbe rubric item has an evaluator, and vice versa', () => {
    const rubricProbes = RUBRIC.filter((r) => r.liveProbe === true).map(
      (r) => r.id
    )
    expect([...PROBE_ITEM_IDS].sort()).toEqual(rubricProbes.sort())
  })

  it('evaluateProbe returns a verdict for every liveProbe item', () => {
    const ids = evaluateProbe(input()).map((r) => r.id)
    expect(ids.sort()).toEqual([...PROBE_ITEM_IDS].sort())
  })

  it('no probed item can be left pending once a probe has run', () => {
    // The bug in one line: a `required` item stuck on `pending` is excluded from the
    // denominator but still counted in mustHaves.total.
    for (const id of PROBE_ITEM_IDS) {
      const r = evaluateProbe(input()).find((x) => x.id === id)
      expect(r?.status === 'pass' || r?.status === 'fail').toBe(true)
    }
  })

  it('core-web-vitals is NOT a header-probe item', () => {
    // LCP/INP/CLS need field data (CrUX) or a lab run; a single response's headers
    // cannot decide them. It is an attestable manual item, not a permanent `pending`.
    const cwv = RUBRIC.find((r) => r.id === 'performance.core-web-vitals')!
    expect(cwv.liveProbe).not.toBe(true)
    expect([...PROBE_ITEM_IDS]).not.toContain('performance.core-web-vitals')
  })
})

describe('evaluateProbe — security.content-type-options', () => {
  const nosniff = (v: string) =>
    evaluateProbe(
      input({ headers: new Headers({ 'x-content-type-options': v }) })
    ).find((x) => x.id === 'security.content-type-options')

  it('passes on nosniff (what Setu itself emits)', () => {
    expect(nosniff('nosniff')?.status).toBe('pass')
  })

  it('is case-insensitive', () => {
    expect(nosniff('NoSniff')?.status).toBe('pass')
  })

  it('fails when the header is absent', () => {
    const r = evaluateProbe(input()).find(
      (x) => x.id === 'security.content-type-options'
    )
    expect(r?.status).toBe('fail')
  })

  it('fails on a value that is not nosniff', () => {
    expect(nosniff('sniff')?.status).toBe('fail')
  })
})

describe('evaluateProbe — security.csp', () => {
  const csp = (headers: Record<string, string>) =>
    evaluateProbe(input({ headers: new Headers(headers) })).find(
      (x) => x.id === 'security.csp'
    )

  it('passes on an enforcing policy with a fetch directive', () => {
    expect(
      csp({
        'content-security-policy': "default-src 'self'; script-src 'self'"
      })?.status
    ).toBe('pass')
  })

  it('fails when only Report-Only is sent — observe mode blocks nothing', () => {
    const r = csp({
      'content-security-policy-report-only': "default-src 'self'"
    })
    expect(r?.status).toBe('fail')
    expect(r?.detail.toLowerCase()).toContain('report-only')
  })

  it('fails when the header is absent', () => {
    const r = evaluateProbe(input()).find((x) => x.id === 'security.csp')
    expect(r?.status).toBe('fail')
  })

  it('fails on a policy with no fetch directive to enforce', () => {
    expect(
      csp({ 'content-security-policy': 'upgrade-insecure-requests' })?.status
    ).toBe('fail')
  })
})
