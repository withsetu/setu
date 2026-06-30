import type { PostRow } from '@setu/core'

/** Map a raw Astro content entry (id = "collection/locale/slug") to a PostRow.
 *  Used in archive-style getStaticPaths blocks so the projection is defined once
 *  and shared across category, tag, and other taxonomy routes. */
export function toPostRow(entry: { id: string; data: Record<string, unknown> }): PostRow {
  const [col = '', loc = '', ...rest] = entry.id.split('/')
  const d = entry.data
  const dateRaw = d['date'] ?? d['pubDate'] ?? d['updatedAt']
  const parsed =
    dateRaw instanceof Date
      ? dateRaw.getTime()
      : typeof dateRaw === 'string' || typeof dateRaw === 'number'
        ? Date.parse(String(dateRaw))
        : NaN
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    id: entry.id,
    collection: col,
    locale: loc,
    slug: rest.join('/'),
    title: typeof d['title'] === 'string' ? (d['title'] as string) : entry.id,
    date: Number.isNaN(parsed) ? null : parsed,
    tags: strArr(d['tags']),
    categories: strArr(d['categories']),
    featuredImage: typeof d['featuredImage'] === 'string' ? (d['featuredImage'] as string) : undefined,
  }
}
