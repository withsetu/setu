import { describe, it, expect } from 'vitest'
import { heroClasses, sizesForLayout } from '../src/hero/hero-classes'

describe('heroClasses', () => {
  it('maps layout + position to classes', () => {
    expect(heroClasses('background', 'bottom-left')).toBe('blk-hero layout-background pos-bottom-left')
  })

  it('handles centered layout with center position', () => {
    expect(heroClasses('centered', 'center')).toBe('blk-hero layout-centered pos-center')
  })

  it('handles split-left layout with top-right position', () => {
    expect(heroClasses('split-left', 'top-right')).toBe('blk-hero layout-split-left pos-top-right')
  })

  it('handles split-right layout with middle-left position', () => {
    expect(heroClasses('split-right', 'middle-left')).toBe('blk-hero layout-split-right pos-middle-left')
  })

  it('handles all 9 text positions for background layout', () => {
    const positions = [
      'top-left', 'top-center', 'top-right',
      'middle-left', 'center', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ]
    for (const pos of positions) {
      expect(heroClasses('background', pos)).toBe(`blk-hero layout-background pos-${pos}`)
    }
  })
})

describe('heroClasses — width param', () => {
  it('appends w-wide when width is wide', () => {
    expect(heroClasses('centered', 'center', 'wide')).toBe('blk-hero layout-centered pos-center w-wide')
  })

  it('appends w-full when width is full', () => {
    expect(heroClasses('background', 'bottom-left', 'full')).toBe('blk-hero layout-background pos-bottom-left w-full')
  })

  it('omits w- class when width is none', () => {
    expect(heroClasses('centered', 'center', 'none')).toBe('blk-hero layout-centered pos-center')
  })

  it('omits w- class when width is undefined (backwards compat)', () => {
    expect(heroClasses('centered', 'center', undefined)).toBe('blk-hero layout-centered pos-center')
    expect(heroClasses('centered', 'center')).toBe('blk-hero layout-centered pos-center')
  })
})

describe('sizesForLayout', () => {
  it('picks responsive sizes per layout', () => {
    expect(sizesForLayout('background')).toBe('100vw')
    expect(sizesForLayout('split-left')).toBe('(min-width: 768px) 50vw, 100vw')
  })

  it('returns 100vw for centered layout', () => {
    expect(sizesForLayout('centered')).toBe('100vw')
  })

  it('returns 50vw at breakpoint for split-right', () => {
    expect(sizesForLayout('split-right')).toBe('(min-width: 768px) 50vw, 100vw')
  })
})
