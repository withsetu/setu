import { describe, it, expect } from 'vitest'
import { projectRow, selectIndexStats } from '@setu/core'
import type { ContentRow, IndexQuery, IndexService } from '@setu/core'
import {
  dashboardCountsFromStats,
  loadRecentEntries
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
  mediaRefs: []
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
    if (r.lifecycle.state === 'draft') drafts++
    else if (r.lifecycle.state === 'staged' || r.lifecycle.state === 'live')
      published++
  }
  return { posts, pages, drafts, published }
}

describe('dashboardCountsFromStats', () => {
  it('derives the four tiles from index stats', () => {
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
      // staged+live: post(1 live + 1 staged) + page(1 live) = 3
      published: 3,
      // draft: post(1) + page(1) = 2
      drafts: 2
    })
  })

  it('empty index → all zeros', () => {
    expect(dashboardCountsFromStats({})).toEqual({
      posts: 0,
      pages: 0,
      published: 0,
      drafts: 0
    })
  })

  it('matches the pre-#587 tally exactly on a mixed fixture (parity)', () => {
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
    expect(fast).toEqual(old)
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
        const rows = (byCollection[q.collection] ?? []).slice(0, q.limit)
        return { rows, total: (byCollection[q.collection] ?? []).length }
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
})
