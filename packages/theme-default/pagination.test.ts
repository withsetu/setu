import { describe, it, expect } from 'vitest'
import { paginationWindow } from './pagination'

describe('paginationWindow', () => {
  it('renders every page when the count is small (≤ 7)', () => {
    expect(paginationWindow(1, 1)).toEqual([1])
    expect(paginationWindow(1, 2)).toEqual([1, 2])
    expect(paginationWindow(2, 2)).toEqual([1, 2])
    expect(paginationWindow(3, 5)).toEqual([1, 2, 3, 4, 5])
    expect(paginationWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(paginationWindow(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('windows a mid-range page: first … current±2 … last', () => {
    expect(paginationWindow(57, 150)).toEqual([
      1,
      'gap',
      55,
      56,
      57,
      58,
      59,
      'gap',
      150
    ])
    expect(paginationWindow(75, 150)).toEqual([
      1,
      'gap',
      73,
      74,
      75,
      76,
      77,
      'gap',
      150
    ])
  })

  it('collapses the leading ellipsis when the window touches the left edge', () => {
    expect(paginationWindow(1, 150)).toEqual([1, 2, 3, 'gap', 150])
    expect(paginationWindow(2, 150)).toEqual([1, 2, 3, 4, 'gap', 150])
    expect(paginationWindow(3, 150)).toEqual([1, 2, 3, 4, 5, 'gap', 150])
    // a gap that would hide only page 2 is rendered as the number itself
    expect(paginationWindow(4, 150)).toEqual([1, 2, 3, 4, 5, 6, 'gap', 150])
    expect(paginationWindow(5, 150)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 150])
    // first current where a real leading gap appears
    expect(paginationWindow(6, 150)).toEqual([
      1,
      'gap',
      4,
      5,
      6,
      7,
      8,
      'gap',
      150
    ])
  })

  it('collapses the trailing ellipsis when the window touches the right edge', () => {
    expect(paginationWindow(150, 150)).toEqual([1, 'gap', 148, 149, 150])
    expect(paginationWindow(149, 150)).toEqual([1, 'gap', 147, 148, 149, 150])
    expect(paginationWindow(148, 150)).toEqual([
      1,
      'gap',
      146,
      147,
      148,
      149,
      150
    ])
    // a gap that would hide only page 149 is rendered as the number itself
    expect(paginationWindow(147, 150)).toEqual([
      1,
      'gap',
      145,
      146,
      147,
      148,
      149,
      150
    ])
    expect(paginationWindow(146, 150)).toEqual([
      1,
      'gap',
      144,
      145,
      146,
      147,
      148,
      149,
      150
    ])
    // last current where a real trailing gap appears
    expect(paginationWindow(145, 150)).toEqual([
      1,
      'gap',
      143,
      144,
      145,
      146,
      147,
      'gap',
      150
    ])
  })

  it('handles exact boundaries just above the render-all threshold', () => {
    expect(paginationWindow(1, 8)).toEqual([1, 2, 3, 'gap', 8])
    expect(paginationWindow(4, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(paginationWindow(5, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(paginationWindow(8, 8)).toEqual([1, 'gap', 6, 7, 8])
    expect(paginationWindow(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    // a gap hiding two or more pages stays a gap (only single-page gaps collapse)
    expect(paginationWindow(5, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 10])
    expect(paginationWindow(5, 11)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 11])
  })

  it('never emits adjacent duplicates and always starts at 1 / ends at last', () => {
    for (let last = 1; last <= 40; last++) {
      for (let current = 1; current <= last; current++) {
        const items = paginationWindow(current, last)
        expect(items[0]).toBe(1)
        expect(items[items.length - 1]).toBe(last)
        expect(items).toContain(current)
        const numbers = items.filter((i): i is number => typeof i === 'number')
        expect(new Set(numbers).size).toBe(numbers.length)
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers)
        // a gap always hides at least two pages (single-page gaps collapse)
        items.forEach((item, idx) => {
          if (item === 'gap') {
            const before = items[idx - 1] as number
            const after = items[idx + 1] as number
            expect(after - before).toBeGreaterThanOrEqual(3)
          }
        })
      }
    }
  })

  it('clamps an out-of-range current page', () => {
    expect(paginationWindow(0, 150)).toEqual(paginationWindow(1, 150))
    expect(paginationWindow(151, 150)).toEqual(paginationWindow(150, 150))
  })
})
