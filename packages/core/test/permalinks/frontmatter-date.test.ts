import { describe, it, expect } from 'vitest'
import {
  parseFrontmatterDate,
  formatFrontmatterDate
} from '../../src/permalinks/frontmatter-date'

describe('parseFrontmatterDate', () => {
  it('accepts a YAML-parsed Date instance', () => {
    expect(
      parseFrontmatterDate({ date: new Date('2026-06-20T00:00:00.000Z') })
    ).toBe(Date.parse('2026-06-20T00:00:00.000Z'))
  })

  it('accepts an ISO date string', () => {
    expect(parseFrontmatterDate({ date: '2026-06-20' })).toBe(
      Date.parse('2026-06-20')
    )
  })

  it('accepts a numeric value (parsed via String(), matching existing behavior)', () => {
    // Numbers go through `Date.parse(String(raw))` like strings do — a bare year, for example,
    // parses as that year, NOT as an epoch-ms timestamp.
    expect(parseFrontmatterDate({ date: 2026 })).toBe(Date.parse('2026'))
  })

  it('falls back to pubDate when date is absent', () => {
    expect(parseFrontmatterDate({ pubDate: '2026-01-01' })).toBe(
      Date.parse('2026-01-01')
    )
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

describe('formatFrontmatterDate', () => {
  it('formats a Date as YYYY-MM-DD (month is 0-indexed: 6 = July)', () => {
    expect(formatFrontmatterDate(new Date(2026, 6, 4, 12, 0))).toBe(
      '2026-07-04'
    )
  })

  it('zero-pads single-digit month and day', () => {
    expect(formatFrontmatterDate(new Date(2026, 0, 9, 0, 0))).toBe('2026-01-09')
  })

  it("uses the Date's LOCAL calendar parts, not its UTC parts", () => {
    // The author picks/stamps a wall-clock day; storing the UTC day instead
    // would shift the URL by one for an evening edit west of UTC. Asserting
    // against the Date's own local getters pins the contract regardless of the
    // runner's timezone.
    const d = new Date(2026, 6, 4, 23, 30)
    const [y, m, day] = formatFrontmatterDate(d).split('-').map(Number)
    expect(y).toBe(d.getFullYear())
    expect(m).toBe(d.getMonth() + 1)
    expect(day).toBe(d.getDate())
  })

  it('round-trips through the UTC-reading resolver to the same calendar day', () => {
    // format (local) → bare date string → parse (UTC midnight) → the resolver's
    // getUTCDate must land on the day the author picked.
    const ms = parseFrontmatterDate({
      date: formatFrontmatterDate(new Date(2026, 6, 4, 23, 30))
    })!
    expect(new Date(ms).getUTCFullYear()).toBe(2026)
    expect(new Date(ms).getUTCMonth()).toBe(6)
    expect(new Date(ms).getUTCDate()).toBe(4)
  })
})
