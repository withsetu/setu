import { describe, it, expect } from 'vitest'
import { sizesForAlign } from '../src/lib/image-align'

describe('sizesForAlign', () => {
  it('returns the content-column hint for none', () => {
    expect(sizesForAlign('none')).toBe('min(100vw, 608px)')
  })
  it('returns the page-width hint for wide', () => {
    expect(sizesForAlign('wide')).toBe('min(100vw, 1024px)')
  })
  it('returns full-viewport for full', () => {
    expect(sizesForAlign('full')).toBe('100vw')
  })
  it('returns the half-column float hint for left and right', () => {
    expect(sizesForAlign('left')).toBe('(max-width: 608px) 100vw, 304px')
    expect(sizesForAlign('right')).toBe('(max-width: 608px) 100vw, 304px')
  })
  it('falls back to the none hint for undefined and unknown values', () => {
    expect(sizesForAlign(undefined)).toBe('min(100vw, 608px)')
    expect(sizesForAlign('sideways')).toBe('min(100vw, 608px)')
  })
})
