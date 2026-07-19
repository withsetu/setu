import { describe, it, expect } from 'vitest'
import type { EntryIndexRow, IndexQuery, SortKey } from '../../src/index'
import { runQuery } from '../../src/index'

/** #661: `compare` returned 0 for equal sort keys with no secondary key, so the
 *  order of tied rows fell through to the adapter's storage order (sqlite rowid
 *  for db-sqlite, whose `loadAll()` has no ORDER BY). The default sort is
 *  `updatedAt` desc and `updatedAt` is null for every entry WITHOUT a draft, so on
 *  a Git-seeded site EVERY row ties — a single re-add reshuffled pagination and an
 *  entry could appear on two pages or on none. `key` is unique per entry, so
 *  breaking every tie with it makes the order a total order. */

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`,
  collection: 'post',
  locale: 'en',
  slug: over.slug ?? 'x',
  title: 'X',
  titleLower: 'x',
  status: 'draft',
  updatedAt: null,
  hasDraft: false,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false,
  ...over
})

/** The Git-seeded shape: no drafts anywhere → every `updatedAt` is null → every
 *  row ties under the default sort. */
const gitSeeded = ['d', 'a', 'c', 'b'].map((slug) => row({ slug }))

const page = (rows: EntryIndexRow[], q: Partial<IndexQuery> = {}) =>
  runQuery(rows, { collection: 'post', offset: 0, limit: 50, ...q }).rows.map(
    (r) => r.slug
  )

describe('runQuery sort is a total order (#661)', () => {
  it('default sort over all-null updatedAt orders by key, not by insertion order', () => {
    expect(page(gitSeeded)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('storage order does not change the result: any permutation sorts the same', () => {
    const permutations = [
      ['a', 'b', 'c', 'd'],
      ['d', 'c', 'b', 'a'],
      ['b', 'd', 'a', 'c'],
      ['c', 'a', 'd', 'b']
    ]
    for (const p of permutations) {
      expect(page(p.map((slug) => row({ slug })))).toEqual(['a', 'b', 'c', 'd'])
    }
  })

  it('re-adding an entry (a delete+upsert moving it to the end of storage) does not reshuffle', () => {
    const before = page(gitSeeded)
    // db-sqlite's upsert-after-remove lands the row at a NEW rowid — i.e. last in
    // `loadAll()`. Under a partial order that silently repaged the whole list.
    const reAdded = [
      ...gitSeeded.filter((r) => r.slug !== 'b'),
      row({ slug: 'b' })
    ]
    expect(page(reAdded)).toEqual(before)
  })

  it('pagination over tied rows is a clean partition: no entry on two pages, none dropped', () => {
    const pages = [
      page(gitSeeded, { offset: 0, limit: 2 }),
      page(gitSeeded, { offset: 2, limit: 2 })
    ]
    expect(pages).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
    const seen = pages.flat()
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('the key tiebreak stays ASCENDING when the direction is descending', () => {
    // Direction negates the PRIMARY comparison only. If the tiebreak were negated
    // too, desc would return ['d','c','b','a'] here and the two directions would
    // disagree about tied rows for no reason the user can see.
    expect(
      page(gitSeeded, { sort: { key: 'updatedAt', dir: 'desc' } })
    ).toEqual(['a', 'b', 'c', 'd'])
    expect(page(gitSeeded, { sort: { key: 'updatedAt', dir: 'asc' } })).toEqual(
      ['a', 'b', 'c', 'd']
    )
  })

  it('ties are broken by key under every sort key, without disturbing the primary order', () => {
    const rows = [
      row({ slug: 'd', updatedAt: 5, titleLower: 'same', status: 'live' }),
      row({ slug: 'a', updatedAt: 5, titleLower: 'same', status: 'live' }),
      row({ slug: 'c', updatedAt: 9, titleLower: 'zzz', status: 'staged' }),
      row({ slug: 'b', updatedAt: 5, titleLower: 'same', status: 'live' })
    ]
    for (const key of ['title', 'status', 'locale'] as SortKey[]) {
      const asc = page(rows, { sort: { key, dir: 'asc' } })
      expect(new Set(asc).size).toBe(4)
      // 'locale' is identical on every row → a pure tiebreak check.
      if (key === 'locale') expect(asc).toEqual(['a', 'b', 'c', 'd'])
    }
    // updatedAt desc: 9 first, then the three tied 5s in key order.
    expect(page(rows, { sort: { key: 'updatedAt', dir: 'desc' } })).toEqual([
      'c',
      'a',
      'b',
      'd'
    ])
  })
})
