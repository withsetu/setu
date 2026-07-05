import { describe, it, expect } from 'vitest'
import { statusBadge } from '../src/lib/status-badge'
import { greeting, relativeTime } from '../src/lib/format'

describe('statusBadge', () => {
  it('maps lifecycle states to badge variants + labels', () => {
    expect(statusBadge({ state: 'draft' })).toEqual({
      label: 'Draft',
      variant: 'warning'
    })
    expect(statusBadge({ state: 'staged' })).toEqual({
      label: 'Staged',
      variant: 'info'
    })
    expect(statusBadge({ state: 'live' })).toEqual({
      label: 'Live',
      variant: 'success'
    })
    expect(statusBadge({ state: 'unpublished' })).toEqual({
      label: 'Unpublished',
      variant: 'secondary'
    })
  })
})

describe('greeting', () => {
  it('is time-of-day based', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning')
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon')
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening')
  })
})

describe('relativeTime', () => {
  const now = 1_000_000_000_000
  it('formats recent edits', () => {
    expect(relativeTime(null)).toBe('—')
    expect(relativeTime(now, now)).toBe('just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
})
