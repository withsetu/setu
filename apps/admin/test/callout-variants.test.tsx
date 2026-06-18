import { describe, it, expect } from 'vitest'
import { calloutVariants, variantFor, CALLOUT_ICONS } from '@setu/blocks'

describe('callout variants', () => {
  it('derives one variant per config editor.variants entry, with tone+icon+label', () => {
    const vs = calloutVariants()
    expect(vs.map((v) => v.type)).toEqual(['info', 'note', 'success', 'warning', 'danger', 'neutral'])
    const success = vs.find((v) => v.type === 'success')
    expect(success?.tone).toBe('green')
    expect(typeof success?.icon).toBe('string')
    expect(typeof success?.label).toBe('string')
  })

  it('falls back to a neutral tone for an unknown type', () => {
    const v = variantFor('totally-unknown')
    expect(v.tone).toBe('neutral')
    expect(v.type).toBe('totally-unknown')
  })

  it('offers a non-empty curated icon set', () => {
    expect(CALLOUT_ICONS.length).toBeGreaterThan(0)
  })
})
