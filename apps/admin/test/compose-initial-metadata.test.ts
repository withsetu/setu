import { describe, it, expect } from 'vitest'
import { composeInitialMetadata } from '../src/editor/new-entry'

describe('composeInitialMetadata (auto-stamp on create)', () => {
  it("stamps a new entry with today's date as YYYY-MM-DD", () => {
    // month is 0-indexed: 6 = July
    const now = new Date(2026, 6, 4, 9, 30)
    expect(composeInitialMetadata(now)).toEqual({ date: '2026-07-04' })
  })

  it('defaults to the current time when no clock is passed', () => {
    const md = composeInitialMetadata()
    expect(typeof md['date']).toBe('string')
    expect(md['date']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
