import { describe, expect, it } from 'vitest'
import { uniqueEntrySlug } from '../../src/engine/slugs'

describe('uniqueEntrySlug', () => {
  it('mints the plain entry slug when free, and reserves it', () => {
    const taken = new Set<string>()
    expect(uniqueEntrySlug('Water Lilies', '27992', taken)).toBe('water-lilies')
    expect(taken.has('water-lilies')).toBe(true)
  })

  it('disambiguates a collision with the stable pack id', () => {
    const taken = new Set(['water-lilies'])
    expect(uniqueEntrySlug('Water Lilies', '27992', taken)).toBe(
      'water-lilies-27992'
    )
  })

  it('keeps counting past a pack-id collision', () => {
    const taken = new Set(['water-lilies', 'water-lilies-27992'])
    expect(uniqueEntrySlug('Water Lilies', '27992', taken)).toBe(
      'water-lilies-27992-2'
    )
  })

  it('falls back to "untitled" for symbol-only titles', () => {
    const taken = new Set<string>()
    expect(uniqueEntrySlug('???', '5', taken)).toBe('untitled')
    expect(uniqueEntrySlug('!!!', '6', taken)).toBe('untitled-6')
  })

  it('is deterministic: identical inputs mint identical slugs', () => {
    const a = uniqueEntrySlug('Une Étude', '99', new Set(['une-étude']))
    const b = uniqueEntrySlug('Une Étude', '99', new Set(['une-étude']))
    expect(a).toBe(b)
    expect(a).toBe('une-étude-99')
  })
})
