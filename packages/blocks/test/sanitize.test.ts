import { describe, it, expect } from 'vitest'
import { safeLinkHref, isSafeColor, safeTextAlign } from '../src/sanitize'

// #857 — validation boundary at the render sink. These guards each neutralize an
// author-controlled string before it reaches an `href` or inline-`style` sink; every
// one is kill-shot tested (disable the guard → the RED case here fires; see the PR).

describe('safeLinkHref (#857 — anchor scheme allowlist)', () => {
  it('passes absolute http(s) URLs through unchanged', () => {
    expect(safeLinkHref('https://example.test/page')).toBe(
      'https://example.test/page'
    )
    expect(safeLinkHref('http://example.test/')).toBe('http://example.test/')
    expect(safeLinkHref('HTTPS://Example.test/A')).toBe(
      'HTTPS://Example.test/A'
    )
  })

  it('passes root-relative paths through unchanged', () => {
    expect(safeLinkHref('/page/about')).toBe('/page/about')
    expect(safeLinkHref('/')).toBe('/')
    expect(safeLinkHref('/a/b?c=d')).toBe('/a/b?c=d')
  })

  it('passes mailto:, tel: and pure fragments through unchanged', () => {
    expect(safeLinkHref('mailto:hi@example.test')).toBe(
      'mailto:hi@example.test'
    )
    expect(safeLinkHref('tel:+15551234567')).toBe('tel:+15551234567')
    expect(safeLinkHref('#section-2')).toBe('#section-2')
    expect(safeLinkHref('#')).toBe('#')
  })

  it('returns null for dangerous schemes (no href emitted)', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeNull()
    expect(safeLinkHref('JavaScript:alert(1)')).toBeNull()
    expect(safeLinkHref('  javascript:alert(1)')).toBeNull()
    expect(safeLinkHref('java\tscript:alert(1)')).toBeNull()
    expect(safeLinkHref('data:text/html,<script>1</script>')).toBeNull()
    expect(safeLinkHref('vbscript:msgbox(1)')).toBeNull()
    expect(safeLinkHref('file:///etc/passwd')).toBeNull()
  })

  it('returns null for protocol-relative authorities (// and its backslash twin)', () => {
    expect(safeLinkHref('//evil.example/x')).toBeNull()
    expect(safeLinkHref('/\\evil.example/x')).toBeNull()
    expect(safeLinkHref('\\\\evil.example/x')).toBeNull()
  })

  it('#968: returns null when tab/LF/CR smuggle the authority past the offset check', () => {
    // The WHATWG parser strips these before parsing, so every one of these resolves to
    // https://evil.example/ — the offset-1 check alone saw a tab, not a second slash.
    // Authorable verbatim through Markdoc string escapes: href="/\t/evil.example".
    expect(safeLinkHref('/\t/evil.example')).toBeNull()
    expect(safeLinkHref('/\n/evil.example')).toBeNull()
    expect(safeLinkHref('/\r/evil.example')).toBeNull()
    expect(safeLinkHref('/\t\\evil.example')).toBeNull()
    expect(safeLinkHref('/\t\n\r/evil.example')).toBeNull()
    expect(safeLinkHref('/\t\t/evil.example')).toBeNull()
    // The scheme branch was already tab-aware (java\tscript: below); an ALLOWLIST stays
    // closed under normalization — `javascript:` matches no accepted shape either way.
    expect(safeLinkHref('java\nscript:alert(1)')).toBeNull()
    expect(safeLinkHref('java\rscript:alert(1)')).toBeNull()
  })

  it('#968: an accepted href comes back normalized — validated string === parsed string', () => {
    // Callers put the RETURN value on the element, so it must be the string the guard
    // actually inspected; returning the raw input would re-open the gap at the sink.
    expect(safeLinkHref('/page\t/about')).toBe('/page/about')
    expect(safeLinkHref('  /page/about  ')).toBe('/page/about')
    expect(safeLinkHref('https://ok.example/a\tb')).toBe(
      'https://ok.example/ab'
    )
    // %09 is not a tab to the parser — it must survive as path content.
    expect(safeLinkHref('/%09/not-an-authority')).toBe('/%09/not-an-authority')
  })

  it('returns null for bare-relative paths and empties', () => {
    expect(safeLinkHref('page/about')).toBeNull()
    expect(safeLinkHref('')).toBeNull()
    expect(safeLinkHref('   ')).toBeNull()
    expect(safeLinkHref(undefined)).toBeNull()
  })
})

describe('isSafeColor (#857 — inline-style color allowlist)', () => {
  it('accepts hex colors (#rgb / #rgba / #rrggbb / #rrggbbaa)', () => {
    expect(isSafeColor('#fff')).toBe(true)
    expect(isSafeColor('#ffff')).toBe(true)
    expect(isSafeColor('#0a0a0a')).toBe(true)
    expect(isSafeColor('#0a0a0aff')).toBe(true) // the shape the color control emits
    expect(isSafeColor('#GGG')).toBe(false)
  })

  it('accepts rgb/rgba and hsl/hsla', () => {
    expect(isSafeColor('rgb(15, 17, 26)')).toBe(true)
    expect(isSafeColor('rgba(15,17,26,0.55)')).toBe(true)
    expect(isSafeColor('hsl(210, 40%, 8%)')).toBe(true)
    expect(isSafeColor('hsla(210,40%,8%,0.5)')).toBe(true)
  })

  it('accepts bare keyword/named colors (letters only — cannot inject)', () => {
    expect(isSafeColor('red')).toBe(true)
    expect(isSafeColor('rebeccapurple')).toBe(true)
    expect(isSafeColor('transparent')).toBe(true)
  })

  it('rejects CSS injection payloads', () => {
    expect(isSafeColor('red;background:url(https://evil/x)')).toBe(false)
    expect(isSafeColor('#fff;position:fixed;inset:0')).toBe(false)
    expect(isSafeColor('url(https://evil/x)')).toBe(false)
    expect(isSafeColor('expression(alert(1))')).toBe(false)
    expect(isSafeColor('rgb(0,0,0);width:100vw')).toBe(false)
    expect(isSafeColor('')).toBe(false)
    expect(isSafeColor(undefined)).toBe(false)
  })
})

describe('safeTextAlign (#857 — node text-align allowlist)', () => {
  it('returns the value for the allowed set', () => {
    expect(safeTextAlign('center')).toBe('center')
    expect(safeTextAlign('right')).toBe('right')
    expect(safeTextAlign('justify')).toBe('justify')
  })

  it('returns undefined for left/absent (the clean default — no style emitted)', () => {
    expect(safeTextAlign('left')).toBeUndefined()
    expect(safeTextAlign(undefined)).toBeUndefined()
    expect(safeTextAlign('')).toBeUndefined()
  })

  it('returns undefined for injection payloads (dropped, not interpolated)', () => {
    expect(safeTextAlign('right;position:fixed')).toBeUndefined()
    expect(safeTextAlign('center;width:100vw')).toBeUndefined()
    expect(safeTextAlign('right ')).toBeUndefined()
    expect(safeTextAlign('CENTER')).toBeUndefined()
  })
})
