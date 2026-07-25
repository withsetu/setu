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
