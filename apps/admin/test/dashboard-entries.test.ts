import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '@setu/core'
import {
  loadDashboardEntries,
  dashboardCounts,
  recentEntries,
  loadActiveLocks
} from '../src/dashboard/entries'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})
const seed: DraftInput[] = [
  {
    collection: 'post',
    locale: 'en',
    slug: 'p1',
    content: doc('a'),
    metadata: { title: 'First Post', status: 'draft' }
  },
  {
    collection: 'post',
    locale: 'en',
    slug: 'p2',
    content: doc('b'),
    metadata: { title: 'Second Post', status: 'draft' }
  },
  {
    collection: 'page',
    locale: 'en',
    slug: 'about',
    content: doc('c'),
    metadata: { title: 'About', status: 'draft' }
  }
]
const noDeploy = () => null

describe('dashboard entries', () => {
  it('loads entries across post + page collections', async () => {
    const rows = await loadDashboardEntries(
      createMemoryDataPort(seed),
      createMemoryGitPort(),
      noDeploy
    )
    expect(rows.map((r) => r.title).sort()).toEqual([
      'About',
      'First Post',
      'Second Post'
    ])
  })

  it('counts by collection and lifecycle', async () => {
    const rows = await loadDashboardEntries(
      createMemoryDataPort(seed),
      createMemoryGitPort(),
      noDeploy
    )
    const c = dashboardCounts(rows)
    expect(c).toEqual({ posts: 2, pages: 1, drafts: 3, published: 0 })
  })

  it('recentEntries caps to the limit', async () => {
    const rows = await loadDashboardEntries(
      createMemoryDataPort(seed),
      createMemoryGitPort(),
      noDeploy
    )
    expect(recentEntries(rows, 2)).toHaveLength(2)
  })

  it('loadActiveLocks returns only locked entries', async () => {
    const data = createMemoryDataPort(seed)
    await data.putLock({
      collection: 'post',
      locale: 'en',
      slug: 'p1',
      lockedBy: 'sarah',
      lockedAt: 0
    })
    const rows = await loadDashboardEntries(
      data,
      createMemoryGitPort(),
      noDeploy
    )
    const locks = await loadActiveLocks(data, rows)
    expect(locks).toEqual([
      {
        collection: 'post',
        locale: 'en',
        slug: 'p1',
        lockedBy: 'sarah',
        lockedAt: 0
      }
    ])
  })
})
