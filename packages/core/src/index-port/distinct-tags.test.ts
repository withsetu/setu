import { describe, expect, it } from 'vitest'
import { selectDistinctTags } from './distinct-tags'
import type { EntryIndexRow } from './types'

const row = (slug: string, tags: string[]): EntryIndexRow => ({
  key: `post\0en\0${slug}`, collection: 'post', locale: 'en', slug,
  title: slug, titleLower: slug, status: 'draft', updatedAt: 0, hasDraft: true, tags,
})

describe('selectDistinctTags', () => {
  const rows = [row('a', ['react', 'nextjs']), row('b', ['react', 'redux']), row('c', ['vue'])]
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
})
