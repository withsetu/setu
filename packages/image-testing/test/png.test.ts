import { describe, it, expect } from 'vitest'
import { makeTestPng, detectFormat } from '../src/index'

describe('makeTestPng', () => {
  it('produces a valid PNG (signature + detectable format)', () => {
    const png = makeTestPng(200, 120)
    expect(png.length).toBeGreaterThan(8)
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(detectFormat(png)).toBe('png')
  })

  it('is deterministic for the same dimensions', () => {
    expect(Array.from(makeTestPng(32, 16))).toEqual(Array.from(makeTestPng(32, 16)))
  })

  it('detectFormat returns null for non-image bytes', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})
