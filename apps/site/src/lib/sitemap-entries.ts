import { resolvePostDate } from './post-date'
import type { SitemapEntry } from './sitemap'

/** Load all content entries as sitemap rows (with a resolved lastmod). Kept separate from
 *  sitemap.ts so the pure builders stay unit-testable without the `astro:content` virtual
 *  module. */
async function load(): Promise<SitemapEntry[]> {
  // Dynamic import (not a static module-level import): `astro:content` only resolves inside
  // Astro's own Vite pipeline — deferring it to call time keeps this module loadable under
  // plain vitest (same pattern + rationale as permalinks.ts).
  const { getCollection } = await import('astro:content')
  const entries = await getCollection('entries')
  return entries.map((e) => {
    const data = e.data as Record<string, unknown>
    return {
      id: e.id,
      data,
      lastmod: resolvePostDate({ data, filePath: e.filePath }).toISOString(),
      body: e.body
    }
  })
}

let cached: Promise<SitemapEntry[]> | null = null

/** All content entries as sitemap rows. Memoized for the build — the 5 sitemap routes share
 *  ONE collection scan + date resolution instead of repeating it per route (#506); recomputed
 *  per call in dev so content edits show up on refresh (mirrors permalinkMap). */
export function loadSitemapEntries(): Promise<SitemapEntry[]> {
  if (import.meta.env.PROD) return (cached ??= load())
  return load()
}
