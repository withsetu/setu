/** A content entry projected for the posts query block. `date` is epoch ms or null. */
export interface PostRow {
  id: string
  collection: string
  locale: string
  slug: string
  title: string
  date: number | null
  tags: string[]
  categories: string[]
  featuredImage?: string
  /** Plain-text excerpt for card display (frontmatter description/summary, else body-derived). */
  excerpt?: string
  /** Frontmatter `published`. Absent → published; only an explicit `false` hides the entry. */
  published?: boolean
  /** Collision-aware URL path from the site permalink map (no leading slash; '' = site root). */
  urlPath?: string
}

export interface PostsQuery {
  collection: string
  locale: string
  category?: string
  tag?: string
  sort: 'newest' | 'oldest' | 'title'
  limit: number
  offset: number
}

const byId = (a: PostRow, b: PostRow): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/**
 * Filter (collection + locale, optional category/tag) → sort → offset/limit slice.
 * `newest`/`oldest` sort by `date` (null always last); `title` sorts ascending. All
 * sorts use a stable `id` tiebreak for deterministic output. Pure — no I/O.
 */
export function selectPosts(rows: PostRow[], q: PostsQuery): PostRow[] {
  const filtered = rows.filter(
    (r) =>
      r.collection === q.collection &&
      r.locale === q.locale &&
      // Published = committed and not explicitly unpublished. `published:false` is Setu's only
      // "not published" signal; absent/true is live. Mirrors the feed + site-health audit.
      r.published !== false &&
      (q.category === undefined || r.categories.includes(q.category)) &&
      (q.tag === undefined || r.tags.includes(q.tag))
  )

  const sorted = [...filtered].sort((a, b) => {
    if (q.sort === 'title') return a.title.localeCompare(b.title) || byId(a, b)
    const an = a.date === null
    const bn = b.date === null
    if (an !== bn) return an ? 1 : -1 // null dates always last
    if (an && bn) return byId(a, b)
    const cmp = q.sort === 'newest' ? b.date! - a.date! : a.date! - b.date!
    return cmp || byId(a, b)
  })

  const start = Math.max(0, q.offset)
  return sorted.slice(start, start + Math.max(0, q.limit))
}
