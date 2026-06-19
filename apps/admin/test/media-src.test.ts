import { describe, it, expect } from 'vitest'
import { resolveMediaSrc } from '../src/editor/media-src'

describe('resolveMediaSrc', () => {
  it('prepends the base to a root-relative path', () => {
    expect(resolveMediaSrc('/uploads/media/x/original.png', 'http://localhost:4444')).toBe(
      'http://localhost:4444/uploads/media/x/original.png',
    )
  })
  it('strips a trailing slash on the base', () => {
    expect(resolveMediaSrc('/uploads/x.png', 'http://localhost:4444/')).toBe('http://localhost:4444/uploads/x.png')
  })
  it('leaves an absolute http(s) src unchanged', () => {
    expect(resolveMediaSrc('https://example.com/p.png', 'http://localhost:4444')).toBe('https://example.com/p.png')
  })
  it('leaves an empty src unchanged and tolerates an undefined base', () => {
    expect(resolveMediaSrc('', 'http://localhost:4444')).toBe('')
    expect(resolveMediaSrc('/uploads/x.png', undefined)).toBe('/uploads/x.png')
  })
})
