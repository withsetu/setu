import { describe, it, expect, vi } from 'vitest'
import { loadSitemapEntries } from '../src/lib/sitemap-entries'

// `astro:content` only exists inside Astro's pipeline — mock it (the module itself defers
// the import to call time, same pattern as permalinks.ts).
const { getCollection } = vi.hoisted(() => ({
  getCollection: vi.fn(() =>
    Promise.resolve([
      {
        id: 'post/en/hello',
        data: { title: 'Hello', date: '2024-02-03' },
        body: 'body text',
        filePath: undefined
      }
    ])
  )
}))
vi.mock('astro:content', () => ({ getCollection }))

describe('loadSitemapEntries', () => {
  it('projects entries with a resolved ISO lastmod', async () => {
    const entries = await loadSitemapEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('post/en/hello')
    expect(entries[0].lastmod).toBe(new Date('2024-02-03').toISOString())
    expect(entries[0].body).toBe('body text')
  })

  it('recomputes per call in dev (astro dev must never serve a stale collection)', async () => {
    getCollection.mockClear()
    await loadSitemapEntries()
    await loadSitemapEntries()
    expect(getCollection).toHaveBeenCalledTimes(2)
  })

  it('memoizes across the 5 sitemap/feed routes in a prod build', async () => {
    vi.stubEnv('PROD', true)
    try {
      getCollection.mockClear()
      await loadSitemapEntries()
      await loadSitemapEntries()
      await loadSitemapEntries()
      expect(getCollection).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
