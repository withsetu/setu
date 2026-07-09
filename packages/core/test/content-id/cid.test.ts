import { describe, it, expect } from 'vitest'
import { newCid, isCid } from '../../src/content-id/cid'

describe('content id (cid)', () => {
  it('mints a canonical UUID', () => {
    expect(isCid(newCid())).toBe(true)
  })

  it('mints a distinct id each call', () => {
    expect(newCid()).not.toBe(newCid())
  })

  it('isCid rejects non-UUID values', () => {
    for (const v of ['', 'not-a-uuid', 'post/en/x', 123, null, undefined, {}]) {
      expect(isCid(v)).toBe(false)
    }
  })

  it('isCid accepts a canonical UUID regardless of case', () => {
    expect(isCid('B1F2C3D4-E5A6-4789-8ABC-DEF012345678')).toBe(true)
  })
})
