import { describe, it, expect } from 'vitest'
import { isCid } from '@setu/core'
import { composeInitialMetadata } from '../src/editor/new-entry'

describe('composeInitialMetadata (auto-stamp on create)', () => {
  it("stamps a new entry with today's date and a fixed injected cid", () => {
    // month is 0-indexed: 6 = July
    const now = new Date(2026, 6, 4, 9, 30)
    expect(composeInitialMetadata(now, 'test-cid')).toEqual({
      cid: 'test-cid',
      date: '2026-07-04'
    })
  })

  it('defaults to the current time and a fresh UUID cid when nothing is passed', () => {
    const md = composeInitialMetadata()
    expect(typeof md['date']).toBe('string')
    expect(md['date']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(isCid(md['cid'])).toBe(true)
  })

  it('mints a distinct cid per call', () => {
    expect(composeInitialMetadata()['cid']).not.toBe(
      composeInitialMetadata()['cid']
    )
  })
})
