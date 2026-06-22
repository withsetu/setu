import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATEGORIES,
  BLOCK_CATEGORY_LABELS,
  DEFAULT_BLOCK_CATEGORY,
  isBlockCategory,
} from './categories'

describe('block categories', () => {
  it('has exactly the seven canonical categories in display order', () => {
    expect([...BLOCK_CATEGORIES]).toEqual([
      'text', 'media', 'layout', 'embed', 'dynamic', 'marketing', 'widget',
    ])
  })

  it('has a label for every category', () => {
    for (const c of BLOCK_CATEGORIES) {
      expect(BLOCK_CATEGORY_LABELS[c]).toBeTruthy()
    }
  })

  it('defaults to text', () => {
    expect(DEFAULT_BLOCK_CATEGORY).toBe('text')
  })

  it('guards membership', () => {
    expect(isBlockCategory('marketing')).toBe(true)
    expect(isBlockCategory('Blocks')).toBe(false)
    expect(isBlockCategory('')).toBe(false)
  })
})
