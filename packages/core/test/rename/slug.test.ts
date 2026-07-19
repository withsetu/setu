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

  // #669: `entrySlugify` had no `normalize()` call, so the SAME title minted two different
  // slugs — and therefore two different published URLs — depending on whether the input arrived
  // composed (NFC) or decomposed (NFD). macOS pastes and Safari input routinely produce NFD.
  it('normalizes Unicode so NFC and NFD input mint the SAME slug (#669)', () => {
    const nfc = 'Café'.normalize('NFC')
    const nfd = 'Café'.normalize('NFD')
    expect(nfc).not.toBe(nfd) // the two spellings really are different strings
    expect(entrySlugify(nfd)).toBe(entrySlugify(nfc))
    expect(entrySlugify(nfc)).toBe('café')
  })

  // NFKC also maps the compatibility characters onto their expansions, so one spelling of a
  // name cannot masquerade as another.
  it('NFKC-folds compatibility characters (#669)', () => {
    expect(entrySlugify('ﬁle')).toBe('file') // U+FB01 ligature fi
    expect(entrySlugify('ſettings')).toBe('settings') // U+017F long s
    expect(entrySlugify('Ⅻ')).toBe('xii') // U+216B roman numeral
    expect(entrySlugify('µ')).toBe('μ') // U+00B5 micro → U+03BC greek mu
  })

  it('trims hyphen floods linearly (ReDoS guard: no polynomial backtracking)', () => {
    expect(entrySlugify('-'.repeat(50) + 'a' + '-'.repeat(50))).toBe('a')
    expect(entrySlugify('-'.repeat(10_000))).toBe('')
    expect(entrySlugify('-'.repeat(10_000) + 'x' + '-'.repeat(10_000))).toBe(
      'x'
    )
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
