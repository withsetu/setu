import { describe, expect, it } from 'vitest'
import { entrySlugify } from '@setu/core'
import { MAX_SLUG_BASE, uniqueEntrySlug } from '../../src/engine/slugs'

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

  it('caps marathon titles below filesystem filename limits, on a word boundary', () => {
    // Real AIC titles run past 300 chars — uncapped they ENAMETOOLONG the fs.
    const title = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const slug = uniqueEntrySlug(title, '385', new Set())
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_BASE)
    expect(slug.endsWith('-')).toBe(false)
    // Still a valid entry slug (fixed point of the shared vocabulary).
    expect(entrySlugify(slug)).toBe(slug)
    // Deterministic, and the collision ladder still fits comfortably.
    const suffixed = uniqueEntrySlug(title, '385', new Set([slug]))
    expect(suffixed).toBe(`${slug}-385`)
    expect(`${suffixed}.mdoc`.length).toBeLessThan(255)
  })

  it('is deterministic: identical inputs mint identical slugs', () => {
    const a = uniqueEntrySlug('Une Étude', '99', new Set(['une-étude']))
    const b = uniqueEntrySlug('Une Étude', '99', new Set(['une-étude']))
    expect(a).toBe(b)
    expect(a).toBe('une-étude-99')
  })
})
