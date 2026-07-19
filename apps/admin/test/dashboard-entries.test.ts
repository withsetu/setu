import { describe, it, expect } from 'vitest'
import { projectRow, selectIndexStats } from '@setu/core'
import type { ContentRow, IndexQuery, IndexService, Lock } from '@setu/core'
import {
  dashboardCountsFromStats,
  loadRecentEntries,
  orderLocksByRecency
} from '../src/dashboard/entries'

const row = (
  collection: string,
  state: ContentRow['lifecycle']['state'],
  slug: string,
  updatedAt: number
): ContentRow => ({
  ref: { collection, locale: 'en', slug },
  title: slug,
  locale: 'en',
  lifecycle: { state },
  updatedAt,
  hasDraft: false,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false
})

/** The pre-#587 client tally — the fetch-all-then-count logic the index now
 *  replaces. Kept HERE as the parity oracle: the fast path must produce
 *  byte-identical numbers. */
function oldDashboardCounts(rows: ContentRow[]) {
  let posts = 0,
    pages = 0,
    drafts = 0,
    published = 0
  for (const r of rows) {
    if (r.ref.collection === 'post') posts++
    else if (r.ref.collection === 'page') pages++
    // #611: 'unpublished' (committed-hidden, already deployed once) counts as a
    // draft for the dashboard's purposes — "not on the site", however it got
    // there. The oracle tracks that so the parity check stays meaningful.
    if (r.lifecycle.state === 'draft' || r.lifecycle.state === 'unpublished')
      drafts++
    else if (r.lifecycle.state === 'staged' || r.lifecycle.state === 'live')
      published++
  }
  return { posts, pages, drafts, published }
}

describe('dashboardCountsFromStats', () => {
  it('derives the five tiles from index stats, live split from staged (#598)', () => {
    const stats = selectIndexStats(
      [
        row('post', 'live', 'a', 5),
        row('post', 'staged', 'b', 4),
        row('post', 'draft', 'c', 3),
        row('post', 'unpublished', 'd', 2),
        row('page', 'live', 'about', 1),
        row('page', 'draft', 'contact', 0)
      ].map(projectRow)
    )
    expect(dashboardCountsFromStats(stats)).toEqual({
      posts: 4,
      pages: 2,
      // live only: post(1) + page(1) = 2 — deployed, visitor-facing
      live: 2,
      // staged only: post(1) = 1 — committed, awaiting deploy
      staged: 1,
      // draft post(1) + page(1) + unpublished post(1) = 3 (#611)
      drafts: 3
    })
  })

  it('empty index → all zeros', () => {
    expect(dashboardCountsFromStats({})).toEqual({
      posts: 0,
      pages: 0,
      live: 0,
      staged: 0,
      drafts: 0
    })
  })

  it('live + staged still equals the pre-#587 published tally (parity, #598)', () => {
    const rows = [
      row('post', 'live', 'a', 9),
      row('post', 'live', 'b', 8),
      row('post', 'staged', 'c', 7),
      row('post', 'draft', 'd', 6),
      row('post', 'unpublished', 'e', 5),
      row('page', 'staged', 'about', 4),
      row('page', 'draft', 'contact', 3),
      row('page', 'unpublished', 'legacy', 2)
    ]
    const old = oldDashboardCounts(rows)
    const fast = dashboardCountsFromStats(
      selectIndexStats(rows.map(projectRow))
    )
    // #598 SPLIT the old Published tile; it did not change what counts as
    // published. The union must still reconcile exactly with the old tally.
    expect(fast.live + fast.staged).toBe(old.published)
    expect(fast.posts).toBe(old.posts)
    expect(fast.pages).toBe(old.pages)
    expect(fast.drafts).toBe(old.drafts)
  })

  // #611: a committed `published: false` entry is 'draft' while the site has
  // never been deployed and 'unpublished' the moment it has (derive.ts). Before
  // this fix 'unpublished' counted toward NO tile, so the very first deploy made
  // Drafts fall 1 -> 0 and the tiles stopped summing to Posts + Pages. The
  // Drafts tile is now draft + unpublished.
  it('counts unpublished toward Drafts (#611)', () => {
    const stats = selectIndexStats(
      [
        row('post', 'live', 'a', 5),
        row('post', 'unpublished', 'taken-down', 4),
        row('page', 'unpublished', 'retired', 3),
        row('page', 'draft', 'contact', 2)
      ].map(projectRow)
    )
    expect(dashboardCountsFromStats(stats)).toEqual({
      posts: 2,
      pages: 2,
      live: 1,
      staged: 0,
      // draft(1) + unpublished(2) — "not on the site", however it got there.
      drafts: 3
    })
  })

  // THE invariant #611 broke. Every post/page entry is in exactly one of the four
  // lifecycle states, and the tiles cover all four, so the status tiles must sum
  // to the collection tiles — before a deploy (nothing 'unpublished' yet) and
  // after one (hidden entries become 'unpublished'). If this fails, some entries
  // are invisible on the dashboard.
  it('Live + Staged + Drafts === Posts + Pages, before and after a deploy (#611)', () => {
    // Same five entries, seen through both lifecycle lenses. Pre-deploy: the two
    // hidden ones read as 'draft'. Post-deploy: they read as 'unpublished'.
    const scenario = (hidden: 'draft' | 'unpublished') =>
      selectIndexStats(
        [
          row('post', hidden === 'draft' ? 'staged' : 'live', 'a', 5),
          row('post', hidden, 'b', 4),
          row('post', 'draft', 'c', 3),
          row('page', hidden === 'draft' ? 'staged' : 'live', 'about', 2),
          row('page', hidden, 'legacy', 1)
        ].map(projectRow)
      )
    for (const phase of ['draft', 'unpublished'] as const) {
      const c = dashboardCountsFromStats(scenario(phase))
      expect(c.live + c.staged + c.drafts).toBe(c.posts + c.pages)
    }
  })
})

describe('loadRecentEntries', () => {
  it('merges per-collection queries, sorts by updatedAt desc, caps to limit', async () => {
    const byCollection: Record<string, ContentRow[]> = {
      post: [
        row('post', 'live', 'p-new', 100),
        row('post', 'draft', 'p-mid', 50),
        row('post', 'draft', 'p-old', 10)
      ],
      page: [
        row('page', 'staged', 'pg-newest', 120),
        row('page', 'draft', 'pg-old', 30)
      ]
    }
    const captured: IndexQuery[] = []
    const index: Pick<IndexService, 'query'> = {
      async query(q) {
        captured.push(q)
        // loadRecentEntries always scopes per collection (#604 made the field
        // optional on the port, not on this caller).
        const all = byCollection[q.collection ?? ''] ?? []
        return { rows: all.slice(0, q.limit), total: all.length }
      }
    }
    const recent = await loadRecentEntries(index, 3)
    // Newest three across BOTH collections, globally sorted.
    expect(recent.map((r) => r.ref.slug)).toEqual([
      'pg-newest',
      'p-new',
      'p-mid'
    ])
    // Each collection queried once, sorted updatedAt desc, limit-capped.
    expect(captured).toHaveLength(2)
    for (const q of captured) {
      expect(q.limit).toBe(3)
      expect(q.offset).toBe(0)
      expect(q.sort).toEqual({ key: 'updatedAt', dir: 'desc' })
    }
    expect(captured.map((q) => q.collection).sort()).toEqual(['page', 'post'])
  })

  it('breaks equal-updatedAt ties deterministically (slug, then collection)', async () => {
    // Same updatedAt across a post and a page; the merge must not depend on
    // which collection page came back first — always slug asc on ties.
    const byCollection: Record<string, ContentRow[]> = {
      post: [row('post', 'live', 'zed', 100), row('post', 'live', 'bob', 100)],
      page: [row('page', 'live', 'amy', 100)]
    }
    const index: Pick<IndexService, 'query'> = {
      async query(q) {
        const rows = byCollection[q.collection ?? ''] ?? []
        return { rows, total: rows.length }
      }
    }
    const recent = await loadRecentEntries(index, 5)
    expect(recent.map((r) => r.ref.slug)).toEqual(['amy', 'bob', 'zed'])
  })
})

describe('orderLocksByRecency', () => {
  const lock = (slug: string, lockedAt: number, collection = 'post'): Lock => ({
    collection,
    locale: 'en',
    slug,
    lockedBy: `${slug}@x.com`,
    lockedAt
  })

  it('orders most-recently-acquired first (lockedAt desc), does not mutate input', () => {
    const input = [lock('a', 10), lock('b', 30), lock('c', 20)]
    const out = orderLocksByRecency(input)
    expect(out.map((l) => l.slug)).toEqual(['b', 'c', 'a'])
    // pure: original order untouched
    expect(input.map((l) => l.slug)).toEqual(['a', 'b', 'c'])
  })

  it('tie-breaks equal lockedAt by slug then collection', () => {
    const out = orderLocksByRecency([
      lock('zed', 5),
      lock('amy', 5, 'page'),
      lock('amy', 5, 'post')
    ])
    expect(out.map((l) => `${l.collection}/${l.slug}`)).toEqual([
      'page/amy',
      'post/amy',
      'post/zed'
    ])
  })

  it('empty in → empty out', () => {
    expect(orderLocksByRecency([])).toEqual([])
  })
})
