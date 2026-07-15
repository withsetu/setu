import { describe, expect, it } from 'vitest'
import {
  defaultSecurityHeaders,
  toCloudflareHeadersFile
} from '../../src/security-headers/security-headers'

const byName = (name: string, opts?: { mediaOrigin?: string }) =>
  defaultSecurityHeaders(opts).find((h) => h.name === name)?.value

describe('defaultSecurityHeaders (#289)', () => {
  it('emits the baseline set in a stable order', () => {
    expect(defaultSecurityHeaders().map((h) => h.name)).toEqual([
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Content-Security-Policy-Report-Only'
    ])
  })

  it('HSTS is max-age only — no preload/includeSubDomains by default (owner opt-in later)', () => {
    expect(byName('Strict-Transport-Security')).toBe('max-age=31536000')
  })

  it('nosniff', () => {
    expect(byName('X-Content-Type-Options')).toBe('nosniff')
  })

  it('X-Frame-Options is SAMEORIGIN, NOT DENY — the admin previews the site in an iframe', () => {
    expect(byName('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('referrer + permissions policies', () => {
    expect(byName('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(byName('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    )
  })

  it('CSP is REPORT-ONLY by design (enforce flip is a later settings toggle) — never enforcing', () => {
    expect(byName('Content-Security-Policy-Report-Only')).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self'; " +
        "base-uri 'self'; form-action 'self'"
    )
    expect(byName('Content-Security-Policy')).toBeUndefined()
  })

  it('appends mediaOrigin to img-src when provided', () => {
    expect(
      byName('Content-Security-Policy-Report-Only', {
        mediaOrigin: 'https://media.example.com'
      })
    ).toContain("img-src 'self' data: https://media.example.com;")
  })
})

describe('toCloudflareHeadersFile (#289)', () => {
  it('emits the CF Pages / Netlify _headers block format: /* then two-space-indented Name: value lines', () => {
    const file = toCloudflareHeadersFile([
      { name: 'X-Content-Type-Options', value: 'nosniff' },
      { name: 'X-Frame-Options', value: 'SAMEORIGIN' }
    ])
    expect(file).toBe(
      '/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n'
    )
  })

  it('the default set round-trips into the file with no enforcing CSP line', () => {
    const file = toCloudflareHeadersFile(defaultSecurityHeaders())
    expect(file).toMatch(/^\/\*\n/)
    expect(file).toContain('  Strict-Transport-Security: max-age=31536000\n')
    expect(file).toContain('  Content-Security-Policy-Report-Only: ')
    // "-Report-Only:" is the ONLY CSP line — an enforcing "Content-Security-Policy:" must not appear.
    expect(file).not.toMatch(/Content-Security-Policy:/)
  })
})
