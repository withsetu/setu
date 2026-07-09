import { describe, it, expect } from 'vitest'
import { resolveMediaBase } from '../src/lib/media-base'

describe('resolveMediaBase', () => {
  it('uses the configured origin, trimming a trailing slash', () => {
    expect(resolveMediaBase('https://cdn.example.com/', true)).toBe(
      'https://cdn.example.com'
    )
    expect(resolveMediaBase('https://cdn.example.com', false)).toBe(
      'https://cdn.example.com'
    )
  })

  it('falls back to the dev media API only in dev', () => {
    expect(resolveMediaBase(undefined, true)).toBe('http://localhost:4444')
  })

  it('falls back to RELATIVE (empty) in a production build — never localhost', () => {
    expect(resolveMediaBase(undefined, false)).toBe('')
  })

  it('trims a whole RUN of trailing slashes (#340)', () => {
    expect(resolveMediaBase('https://cdn.example.com///', false)).toBe(
      'https://cdn.example.com'
    )
    expect(resolveMediaBase('/', false)).toBe('')
  })

  it('does not catastrophically backtrack on adversarial input (#340)', () => {
    // The old `/\/+$/` trim was quadratic on this shape.
    const evil = 'x' + '/'.repeat(100_000) + 'y'
    const t = performance.now()
    expect(resolveMediaBase(evil, false)).toBe(evil)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})
