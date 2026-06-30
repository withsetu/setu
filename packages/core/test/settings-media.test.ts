import { describe, it, expect } from 'vitest'
import { parseSettings } from '../src/settings/schema'

describe('media settings', () => {
  it('defaults media.imageFormat=webp and imageLqip=false when absent', () => {
    const s = parseSettings({ general: { title: 'X' } })
    expect(s.media.imageFormat).toBe('webp')
    expect(s.media.imageLqip).toBe(false)
  })
  it('parses provided media settings', () => {
    const s = parseSettings({ media: { imageFormat: 'both', imageLqip: true } })
    expect(s.media).toEqual({ imageFormat: 'both', imageLqip: true })
  })
  it('falls back to default on an invalid imageFormat', () => {
    const s = parseSettings({ media: { imageFormat: 'jpeg', imageLqip: true } })
    expect(s.media.imageFormat).toBe('webp')
  })
})
