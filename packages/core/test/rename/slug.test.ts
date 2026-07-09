import { describe, expect, it } from 'vitest'
import { entrySlugify, isValidEntrySlug } from '../../src/index'

describe('entrySlugify', () => {
  it('lowercases, hyphenates whitespace/underscores, drops punctuation', () => {
    expect(entrySlugify('Hello World!')).toBe('hello-world')
    expect(entrySlugify('  spaced   out  ')).toBe('spaced-out')
    expect(entrySlugify('under_score')).toBe('under-score')
    expect(entrySlugify('a--b')).toBe('a-b')
  })

  it('keeps Unicode letters (matches minting: Über uns → über-uns)', () => {
    expect(entrySlugify('Über uns')).toBe('über-uns')
    expect(entrySlugify('Déjà Vu')).toBe('déjà-vu')
  })

  it('returns "" for empty/symbol-only input', () => {
    expect(entrySlugify('')).toBe('')
    expect(entrySlugify('???!!!')).toBe('')
  })
})

describe('isValidEntrySlug', () => {
  it('accepts canonical slugs, including Unicode', () => {
    for (const ok of ['hello-world', 'über-uns', 'a', 'post-2']) {
      expect(isValidEntrySlug(ok)).toBe(true)
    }
  })

  it('rejects empty, the reserved compose sentinel, and non-fixed-points', () => {
    for (const bad of [
      '',
      'new', // compose-route sentinel
      'Has Caps',
      '-leading',
      'trailing-',
      'a--b',
      'under_score',
      'sp ace'
    ]) {
      expect(isValidEntrySlug(bad)).toBe(false)
    }
  })
})
