import { describe, expect, it } from 'vitest'
import { selectDistinctTags, tagMatchesPrefix } from './distinct-tags'
import type { EntryIndexRow } from './types'

const row = (slug: string, tags: string[]): EntryIndexRow => ({
  key: `post\0en\0${slug}`,
  collection: 'post',
  locale: 'en',
  slug,
  title: slug,
  titleLower: slug,
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  date: null,
  tags,
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false
})

describe('selectDistinctTags', () => {
  const rows = [
    row('a', ['react', 'nextjs']),
    row('b', ['react', 'redux']),
    row('c', ['vue'])
  ]
  it('prefix-filters, dedupes across rows, sorts ascending', () => {
    expect(selectDistinctTags(rows, 're', 10)).toEqual(['react', 'redux'])
  })
  it('empty prefix returns first `limit` tags alphabetically', () => {
    expect(selectDistinctTags(rows, '', 2)).toEqual(['nextjs', 'react'])
  })
  it('is case-insensitive on the prefix', () => {
    expect(selectDistinctTags(rows, 'RE', 10)).toEqual(['react', 'redux'])
  })
  it('returns [] when nothing matches', () => {
    expect(selectDistinctTags(rows, 'zzz', 10)).toEqual([])
  })

  // #895: the prefix was lowercased but the tag was not, so a capitalised tag was
  // unreachable by EVERY non-empty prefix — the type-ahead showed nothing and the
  // author created a duplicate, which is the one outcome it exists to prevent.
  describe('capitalised tags (#895)', () => {
    const mixed = [
      row('a', ['JavaScript', 'Web Dev']),
      row('b', ['javascript', 'jest'])
    ]
    it('matches a capitalised tag from a lowercase prefix', () => {
      expect(selectDistinctTags(mixed, 'java', 10)).toEqual([
        'JavaScript',
        'javascript'
      ])
    })
    it('matches a capitalised tag from a capitalised prefix', () => {
      expect(selectDistinctTags(mixed, 'Java', 10)).toEqual([
        'JavaScript',
        'javascript'
      ])
    })
    it('preserves the original casing rather than folding it', () => {
      expect(selectDistinctTags(mixed, 'w', 10)).toEqual(['Web Dev'])
    })
    it('still excludes non-matches', () => {
      expect(selectDistinctTags(mixed, 'je', 10)).toEqual(['jest'])
    })
  })
})

// The predicate is shared with the admin's draft-tag overlay
// (apps/admin/src/data/http-index-service.ts), which used to keep its own copy.
// Draft tags are normalized to lowercase before that overlay sees them, so the
// mixed-case case is not observable from the admin side — it is covered here, on
// the single implementation both call.
describe('tagMatchesPrefix', () => {
  it('folds both sides', () => {
    expect(tagMatchesPrefix('JavaScript', 'java')).toBe(true)
    expect(tagMatchesPrefix('javascript', 'JAVA')).toBe(true)
    expect(tagMatchesPrefix('JavaScript', 'Java')).toBe(true)
  })
  it('trims the prefix but matches on the tag as given', () => {
    expect(tagMatchesPrefix('JavaScript', '  java  ')).toBe(true)
    expect(tagMatchesPrefix(' JavaScript', 'java')).toBe(false)
  })
  it('an empty prefix matches everything', () => {
    expect(tagMatchesPrefix('JavaScript', '')).toBe(true)
  })
  it('is a prefix match, not a substring match', () => {
    expect(tagMatchesPrefix('JavaScript', 'script')).toBe(false)
  })
})
