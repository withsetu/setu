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

  // #654: compatibility characters fold into ASCII on a case-folding filesystem (APFS/NTFS),
  // so a slug carrying one collides with a DIFFERENT published entry. NFKC folds them at the
  // minting step, so the collision can never be minted in the first place.
  it('NFKC-folds compatibility characters (#654)', () => {
    expect(entrySlugify('ﬁle')).toBe('file') // U+FB01 ligature fi
    expect(entrySlugify('ſettings')).toBe('settings') // U+017F long s
    expect(entrySlugify('Ⅻ')).toBe('xii') // U+216B roman numeral
    expect(entrySlugify('µ')).toBe('μ') // U+00B5 micro → U+03BC greek mu
  })

  // The residue NFKC does not reach: characters whose case FOLD differs from their simple
  // lowercase mapping. `ß`→`ss`, `ı`→`i`, `ς`→`σ` all collide on a case-folding filesystem.
  it('case-folds the characters toLowerCase() leaves alone (#654)', () => {
    expect(entrySlugify('Straße')).toBe('strasse')
    expect(entrySlugify('ırmak')).toBe('irmak')
    expect(entrySlugify('Ελλάς')).toBe('ελλάσ')
  })

  it('is idempotent — every output is a fixed point (the validation invariant)', () => {
    const corpus = [
      'Hello World!',
      'Über uns',
      'Déjà Vu'.normalize('NFD'),
      'ﬁle',
      'Straße',
      'İstanbul',
      'ırmak',
      'Ελλάς',
      '日本語',
      'ǰ',
      'Ⅻ',
      'µ',
      'ſettings'
    ]
    for (const text of corpus) {
      const once = entrySlugify(text)
      expect(entrySlugify(once), `idempotent for ${JSON.stringify(text)}`).toBe(
        once
      )
      if (once !== '')
        expect(
          isValidEntrySlug(once),
          `valid for ${JSON.stringify(text)}`
        ).toBe(true)
    }
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

  // #654: THE security property. A valid slug must be its own case-fold and its own NFKC form,
  // so no two distinct valid slugs can resolve to the same file on a case-folding filesystem.
  it('rejects fold-unstable slugs that would collide on APFS/NTFS (#654)', () => {
    for (const bad of [
      'ﬁle', // U+FB01 — folds onto the published `file`
      'ſettings', // U+017F — folds onto `settings`
      'µ', // U+00B5 — folds onto the Greek `μ`
      'straße', // folds onto `strasse`
      'ırmak', // folds onto `irmak`
      'ελλάς', // final sigma folds onto `σ` (context-free, as APFS folds it)
      // NFD (`e` + U+0301 COMBINING ACUTE), written as an escape so no editor can silently
      // recompose it. Same file as the NFC `café` on APFS, so only one of the two may be valid.
      'cafe\u0301'
    ]) {
      expect(
        isValidEntrySlug(bad),
        `isValidEntrySlug(${JSON.stringify(bad)})`
      ).toBe(false)
    }
  })

  it('still accepts genuinely-Unicode slugs that are fold-stable', () => {
    for (const ok of ['über-uns', 'café', 'déjà-vu', '日本語', 'μ', 'ελλάσ']) {
      expect(
        isValidEntrySlug(ok),
        `isValidEntrySlug(${JSON.stringify(ok)})`
      ).toBe(true)
    }
  })
})
