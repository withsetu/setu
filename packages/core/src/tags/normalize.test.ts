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
})

describe('normalizeTags', () => {
  it('normalizes, drops empties, dedupes preserving order', () => {
    expect(normalizeTags(['React', 'react', '!!', 'Next JS', 'next-js'])).toEqual(['react', 'next-js'])
  })
  it('returns [] for an empty list', () => {
    expect(normalizeTags([])).toEqual([])
  })
})
