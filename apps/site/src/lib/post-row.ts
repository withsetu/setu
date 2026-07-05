import { excerpt, type PostRow } from '@setu/core'

export function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : []
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Map a raw Astro content entry (id = "collection/locale/slug") to a PostRow. Single projection
 *  shared by every archive-style getStaticPaths (posts, category, tag, …) so they agree on fields
 *  and ordering. Pass `body` to derive a card excerpt (frontmatter description/summary wins). */
export function toPostRow(
  entry: {
    id: string
    data: Record<string, unknown>
    body?: string
  },
  urlPath?: string
): PostRow {
  const [col = '', loc = '', ...rest] = entry.id.split('/')
  const d = entry.data
  const dateRaw = d['date'] ?? d['pubDate'] ?? d['updatedAt']
  const parsed =
    dateRaw instanceof Date
      ? dateRaw.getTime()
      : typeof dateRaw === 'string' || typeof dateRaw === 'number'
        ? Date.parse(String(dateRaw))
        : NaN
  const cardExcerpt =
    str(d['description']) || str(d['summary']) || excerpt(entry.body ?? '', 160)
  return {
    id: entry.id,
    collection: col,
    locale: loc,
    slug: rest.join('/'),
    title: typeof d['title'] === 'string' ? d['title'] : entry.id,
    date: Number.isNaN(parsed) ? null : parsed,
    // `published:false` is Setu's only "hidden" signal; absent/true is live. Projecting it lets
    // selectPosts hide drafts from the archives too (mirrors the posts archive + feed + audit).
    published: d['published'] === false ? false : undefined,
    tags: strArr(d['tags']),
    categories: strArr(d['categories']),
    featuredImage:
      typeof d['featuredImage'] === 'string' ? d['featuredImage'] : undefined,
    excerpt: cardExcerpt || undefined,
    ...(urlPath !== undefined ? { urlPath } : {})
  }
}
