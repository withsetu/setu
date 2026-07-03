import { describe, expect, it } from 'vitest'
import { parseSettings } from './schema'

describe('settings — relatedPosts', () => {
  it('fills relatedPosts defaults when absent', () => {
    const s = parseSettings({})
    expect(s.reading.relatedPosts).toEqual({
      enabled: true,
      heading: 'Read Next',
      count: 3,
      showImage: true
    })
  })

  it('merges a partial relatedPosts override over defaults', () => {
    const s = parseSettings({
      reading: { relatedPosts: { showImage: false, count: 5 } }
    })
    expect(s.reading.relatedPosts).toEqual({
      enabled: true,
      heading: 'Read Next',
      count: 5,
      showImage: false
    })
  })
})
