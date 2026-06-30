import { describe, it, expect } from 'vitest'
import { parseHealthState, setHealthRecord } from '../src/index'

describe('parseHealthState', () => {
  it('defaults to empty on missing/malformed input (never throws)', () => {
    expect(parseHealthState(undefined)).toEqual({ items: {}, sections: {} })
    expect(parseHealthState('not an object')).toEqual({ items: {}, sections: {} })
    expect(parseHealthState({ items: 5 })).toEqual({ items: {}, sections: {} })
  })
  it('keeps well-formed records and drops malformed ones', () => {
    const s = parseHealthState({ items: { 'a.b': { state: 'attested', at: '2026-01-01', by: 'Local' }, bad: { state: 'nope' } }, sections: { i18n: { state: 'na', at: '2026-01-01', by: 'Local' } } })
    expect(s.items['a.b']?.state).toBe('attested')
    expect(s.items.bad).toBeUndefined()
    expect(s.sections.i18n?.state).toBe('na')
  })
})

describe('setHealthRecord', () => {
  it('sets and clears item records immutably', () => {
    const a = setHealthRecord({ items: {}, sections: {} }, 'item', 'x', { state: 'na', at: '2026-01-01', by: 'Local' })
    expect(a.items.x?.state).toBe('na')
    const b = setHealthRecord(a, 'item', 'x', null)
    expect(b.items.x).toBeUndefined()
    expect(a.items.x?.state).toBe('na') // original untouched
  })
})
