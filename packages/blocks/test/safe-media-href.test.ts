import { describe, it, expect } from 'vitest'
import { safeMediaHref, resolveMediaSrc } from '../src/safe-media-href'

describe('safeMediaHref (#177 audit — anchor scheme allowlist)', () => {
  it('passes absolute http(s) URLs through unchanged', () => {
    expect(safeMediaHref('https://cdn.example.test/a.jpg', 'http://x')).toBe(
      'https://cdn.example.test/a.jpg'
    )
    expect(safeMediaHref('http://cdn.example.test/a.jpg', '')).toBe(
      'http://cdn.example.test/a.jpg'
    )
  })

  it('prefixes the media base onto root-relative paths', () => {
    expect(safeMediaHref('/media/2026/07/a.jpg', 'http://x')).toBe(
      'http://x/media/2026/07/a.jpg'
    )
    expect(safeMediaHref('/media/a.jpg', '')).toBe('/media/a.jpg')
  })

  it('returns null for dangerous or unresolvable srcs (no anchor rendered)', () => {
    expect(safeMediaHref('javascript:alert(1)', 'http://x')).toBeNull()
    expect(safeMediaHref('JavaScript:alert(1)', 'http://x')).toBeNull()
    expect(
      safeMediaHref('data:text/html,<script>1</script>', 'http://x')
    ).toBeNull()
    expect(safeMediaHref('vbscript:x', 'http://x')).toBeNull()
    expect(safeMediaHref('file:///etc/passwd', 'http://x')).toBeNull()
    // protocol-relative would resolve to an external origin once base is '' in prod
    expect(safeMediaHref('//evil.example/a.jpg', '')).toBeNull()
    // backslash twin: the WHATWG URL parser normalizes \ to /, so /\host is the
    // same external authority as //host
    expect(safeMediaHref('/\\evil.example/a.jpg', '')).toBeNull()
    expect(safeMediaHref('/\\evil.example/a.jpg', 'http://x')).toBeNull()
    // bare relative paths can't be resolved to a full-size original reliably
    expect(safeMediaHref('a.jpg', 'http://x')).toBeNull()
    expect(safeMediaHref('', 'http://x')).toBeNull()
  })

  it('#968: returns null when tab/LF/CR smuggle the authority past the offset check', () => {
    // The WHATWG parser strips these before parsing, so each resolves off-origin; the
    // offset-1 check alone saw a tab, not a second slash.
    expect(safeMediaHref('/\t/evil.example/a.jpg', '')).toBeNull()
    expect(safeMediaHref('/\n/evil.example/a.jpg', '')).toBeNull()
    expect(safeMediaHref('/\r/evil.example/a.jpg', '')).toBeNull()
    expect(safeMediaHref('/\t\\evil.example/a.jpg', '')).toBeNull()
    expect(safeMediaHref('/\t/evil.example/a.jpg', 'http://x')).toBeNull()
  })

  it('#968: an accepted src comes back normalized — validated string === parsed string', () => {
    expect(safeMediaHref('/media\t/a.jpg', '')).toBe('/media/a.jpg')
    expect(safeMediaHref('  /media/a.jpg  ', 'http://x')).toBe(
      'http://x/media/a.jpg'
    )
    expect(safeMediaHref('https://cdn.example.test/a\t.jpg', '')).toBe(
      'https://cdn.example.test/a.jpg'
    )
  })
})

describe('resolveMediaSrc (#857 — shared media-src resolver, protocol-relative guard)', () => {
  it('passes absolute http(s) URLs through unchanged (behavior parity)', () => {
    expect(
      resolveMediaSrc('https://cdn.example.test/clip.mp4', 'http://x')
    ).toBe('https://cdn.example.test/clip.mp4')
    expect(resolveMediaSrc('http://cdn.example.test/clip.mp4', '')).toBe(
      'http://cdn.example.test/clip.mp4'
    )
  })

  it('prefixes the media base onto root-relative paths (behavior parity)', () => {
    expect(resolveMediaSrc('/media/clip.mp4', 'https://cdn.test')).toBe(
      'https://cdn.test/media/clip.mp4'
    )
    expect(resolveMediaSrc('/media/clip.mp4', '')).toBe('/media/clip.mp4')
  })

  it('returns null for protocol-relative and dangerous srcs (attacker-chosen origin)', () => {
    expect(resolveMediaSrc('//evil.example/clip.mp4', '')).toBeNull()
    expect(resolveMediaSrc('/\\evil.example/clip.mp4', '')).toBeNull()
    expect(resolveMediaSrc('javascript:alert(1)', 'http://x')).toBeNull()
    expect(resolveMediaSrc('', 'http://x')).toBeNull()
    expect(resolveMediaSrc('a.jpg', 'http://x')).toBeNull()
  })

  it('#968: returns null for tab/LF/CR-smuggled authorities (display sink)', () => {
    expect(resolveMediaSrc('/\t/evil.example/clip.mp4', '')).toBeNull()
    expect(resolveMediaSrc('/\n/evil.example/clip.mp4', '')).toBeNull()
    expect(resolveMediaSrc('/\r/evil.example/clip.mp4', '')).toBeNull()
    expect(
      resolveMediaSrc('/\t\\evil.example/clip.mp4', 'https://cdn.test')
    ).toBeNull()
  })
})
