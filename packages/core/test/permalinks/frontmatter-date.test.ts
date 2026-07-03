import { describe, it, expect } from 'vitest'
import { parseFrontmatterDate } from '../../src/permalinks/frontmatter-date'

describe('parseFrontmatterDate', () => {
  it('accepts a YAML-parsed Date instance', () => {
    expect(parseFrontmatterDate({ date: new Date('2026-06-20T00:00:00.000Z') })).toBe(
      Date.parse('2026-06-20T00:00:00.000Z')
    )
  })

  it('accepts an ISO date string', () => {
    expect(parseFrontmatterDate({ date: '2026-06-20' })).toBe(Date.parse('2026-06-20'))
  })

  it('accepts a numeric value (parsed via String(), matching existing behavior)', () => {
    // Numbers go through `Date.parse(String(raw))` like strings do — a bare year, for example,
    // parses as that year, NOT as an epoch-ms timestamp.
    expect(parseFrontmatterDate({ date: 2026 })).toBe(Date.parse('2026'))
  })

  it('falls back to pubDate when date is absent', () => {
    expect(parseFrontmatterDate({ pubDate: '2026-01-01' })).toBe(Date.parse('2026-01-01'))
  })

  it('prefers date over pubDate when both are present', () => {
    expect(
      parseFrontmatterDate({ date: '2026-06-20', pubDate: '2020-01-01' })
    ).toBe(Date.parse('2026-06-20'))
  })

  it('ignores updatedAt entirely (an edit must not move a URL)', () => {
    expect(parseFrontmatterDate({ updatedAt: '2026-06-20' })).toBeNull()
  })

  it('returns null when neither date nor pubDate is present', () => {
    expect(parseFrontmatterDate({})).toBeNull()
  })

  it('returns null for an unparseable value', () => {
    expect(parseFrontmatterDate({ date: 'not-a-date' })).toBeNull()
  })
})
