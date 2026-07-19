import { describe, it, expect } from 'vitest'
import type { EntryIndexRow } from '../../src/index'
import { runQuery } from '../../src/index'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`,
  collection: 'post',
  locale: 'en',
  slug: 'x',
  title: 'X',
  titleLower: 'x',
  status: 'draft',
  updatedAt: 0,
  hasDraft: true,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false,
  ...over
})

const rows: EntryIndexRow[] = [
  row({
    slug: 'a',
    title: 'Alpha',
    titleLower: 'alpha',
    updatedAt: 3,
    status: 'live'
  }),
  row({
    slug: 'b',
    title: 'Bravo',
    titleLower: 'bravo',
    updatedAt: 1,
    status: 'draft'
  }),
  row({
    slug: 'c',
    title: 'Charlie',
    titleLower: 'charlie',
    updatedAt: null,
    status: 'draft'
  }),
  {
    ...row({ slug: 'd', title: 'Delta', titleLower: 'delta' }),
    collection: 'page'
  }
]

describe('runQuery', () => {
  it('filters to the collection and sorts by updatedAt desc with nulls last', () => {
    const r = runQuery(rows, { collection: 'post', offset: 0, limit: 10 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.slug)).toEqual(['a', 'b', 'c'])
  })

  it('filters by status', () => {
    const r = runQuery(rows, {
      collection: 'post',
      status: 'draft',
      offset: 0,
      limit: 10
    })
    expect(r.rows.map((x) => x.slug)).toEqual(['b', 'c'])
  })

  it('searches title and slug case-insensitively', () => {
    expect(
      runQuery(rows, {
        collection: 'post',
        q: 'ALP',
        offset: 0,
        limit: 10
      }).rows.map((x) => x.slug)
    ).toEqual(['a'])
    expect(
      runQuery(rows, { collection: 'post', q: 'b', offset: 0, limit: 10 })
        .rows.map((x) => x.slug)
        .sort()
    ).toEqual(['b'])
  })

  it('sorts by title asc and paginates with a stable total', () => {
    const r = runQuery(rows, {
      collection: 'post',
      sort: { key: 'title', dir: 'asc' },
      offset: 1,
      limit: 1
    })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.slug)).toEqual(['b'])
  })
})

it('sorts by locale (asc/desc) — #145', () => {
  const localed = [
    row({ slug: 'fr-post', locale: 'fr' }),
    row({ slug: 'de-post', locale: 'de' }),
    row({ slug: 'en-post', locale: 'en' })
  ]
  const asc = runQuery(localed, {
    collection: 'post',
    sort: { key: 'locale', dir: 'asc' },
    offset: 0,
    limit: 10
  })
  expect(asc.rows.map((x) => x.locale)).toEqual(['de', 'en', 'fr'])
  const desc = runQuery(localed, {
    collection: 'post',
    sort: { key: 'locale', dir: 'desc' },
    offset: 0,
    limit: 10
  })
  expect(desc.rows.map((x) => x.locale)).toEqual(['fr', 'en', 'de'])
})

describe('runQuery — cross-collection scope (#604)', () => {
  // The At-a-glance status tiles count post + page together; their destination
  // list has to be able to show the same set, or the number you click never
  // equals the list you land on (#604). Omitting `collection` is that scope.
  it('omitting collection queries every collection', () => {
    const r = runQuery(rows, { offset: 0, limit: 10 })
    expect(r.total).toBe(4)
    expect(r.rows.map((x) => x.slug)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('cross-collection scope still applies the status filter', () => {
    const r = runQuery(rows, {
      status: 'not-published',
      offset: 0,
      limit: 10
    })
    // draft posts b + c and the draft page d — every collection, one status.
    expect(r.rows.map((x) => x.slug).sort()).toEqual(['b', 'c', 'd'])
  })
})

describe("runQuery — 'not-published' union (#611)", () => {
  const statuses: EntryIndexRow[] = [
    row({ slug: 'l', status: 'live', updatedAt: 4 }),
    row({ slug: 's', status: 'staged', updatedAt: 3 }),
    row({ slug: 'd', status: 'draft', updatedAt: 2 }),
    row({ slug: 'u', status: 'unpublished', updatedAt: 1 })
  ]

  it('matches draft + unpublished', () => {
    const r = runQuery(statuses, {
      collection: 'post',
      status: 'not-published',
      offset: 0,
      limit: 10
    })
    expect(r.rows.map((x) => x.slug)).toEqual(['d', 'u'])
  })

  // The two unions must partition the lifecycle exactly — no entry in both, none
  // in neither. That is what makes the dashboard's Live+Staged+Drafts ===
  // Posts+Pages invariant hold once entries start reaching 'unpublished' (#611).
  it("partitions the lifecycle with 'published' — no overlap, no gap", () => {
    const q = (status: 'published' | 'not-published') =>
      runQuery(statuses, {
        collection: 'post',
        status,
        offset: 0,
        limit: 10
      }).rows.map((x) => x.slug)
    const pub = q('published')
    const not = q('not-published')
    expect(pub.filter((s) => not.includes(s))).toEqual([])
    expect([...pub, ...not].sort()).toEqual(['d', 'l', 's', 'u'])
  })
})
