import { describe, expect, it } from 'vitest'
import { normalizeTag, normalizeTags } from './normalize'

describe('normalizeTag', () => {
  it('lowercases, trims, hyphenates spaces', () => {
    expect(normalizeTag('  React Native ')).toBe('react-native')
  })
  it('drops punctuation and collapses hyphens', () => {
    expect(normalizeTag('C++ / Rust!!')).toBe('c-rust')
  })
  it('returns empty string for symbol-only or empty input', () => {
    expect(normalizeTag('!!!')).toBe('')
    expect(normalizeTag('   ')).toBe('')
  })
  it('treats underscores as separators', () => {
    expect(normalizeTag('hello_world')).toBe('hello-world')
  })
  it('strips leading and trailing hyphen runs (edge trim)', () => {
    expect(normalizeTag('---react---')).toBe('react')
    expect(normalizeTag('- a - b -')).toBe('a-b')
  })
  it('does not catastrophically backtrack on adversarial input (#340)', () => {
    // The old `/^-+|-+$/g` edge-trim was quadratic on this shape in isolation.
    const evil = 'x' + '-'.repeat(100_000) + 'y'
    const t = performance.now()
    normalizeTag(evil)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})

describe('normalizeTags', () => {
  it('normalizes, drops empties, dedupes preserving order', () => {
    expect(
      normalizeTags(['React', 'react', '!!', 'Next JS', 'next-js'])
    ).toEqual(['react', 'next-js'])
  })
  it('returns [] for an empty list', () => {
    expect(normalizeTags([])).toEqual([])
  })
})
