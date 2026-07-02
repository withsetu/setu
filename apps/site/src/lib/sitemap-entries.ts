import { getCollection } from 'astro:content'
import { resolvePostDate } from './post-date'
import type { SitemapEntry } from './sitemap'

/** Load all content entries as sitemap rows (with a resolved lastmod). Kept separate from
 *  sitemap.ts so the pure builders stay unit-testable without the `astro:content` virtual module. */
export async function loadSitemapEntries(): Promise<SitemapEntry[]> {
  const entries = await getCollection('entries')
  return entries.map((e) => {
    const data = e.data as Record<string, unknown>
    return { id: e.id, data, lastmod: resolvePostDate({ data, filePath: e.filePath }).toISOString() }
  })
}
