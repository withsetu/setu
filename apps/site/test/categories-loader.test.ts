import { describe, it, expect } from 'vitest'
import { loadCategories } from '../src/lib/categories'

describe('loadCategories', () => {
  it('returns [] when taxonomy/categories.yaml is absent (never throws)', () => {
    const prev = process.env.SETU_CONTENT_DIR
    // point at a dir whose parent has no taxonomy/categories.yaml
    process.env.SETU_CONTENT_DIR = '/nonexistent-xyz/content'
    try {
      expect(loadCategories()).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.SETU_CONTENT_DIR
      else process.env.SETU_CONTENT_DIR = prev
    }
  })
})
