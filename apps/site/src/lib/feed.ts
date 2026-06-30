import { resolvePostDate, type DatableEntry } from './post-date'
import { toUrlPath } from './url'

export interface FeedItem {
  title: string
  link: string
  pubDate: Date
  description: string
}

export interface FeedRow {
  id: string
  data: Record<string, unknown>
  body?: string
  date: Date
}

/** Plain-text excerpt from a raw Markdoc body: strip {% tags %} + markdown syntax,
 *  collapse whitespace, truncate to `max` chars on a word boundary with an ellipsis. */
export function excerpt(body: string, max = 200): string {
  const text = body
    .replace(/\{%[\s\S]*?%\}/g, ' ')        // markdoc tags (lazy: tolerates % / newlines in body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[#>*_`~]/g, ' ')              // md punctuation
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}

/** Pure: keep published default-locale posts, newest first, capped at `limit`. */
export function selectFeedPosts(rows: FeedRow[], limit: number): FeedRow[] {
  return rows
    .filter((r) => {
      const [collection, locale] = r.id.split('/')
      if (collection !== 'post' || locale !== 'en') return false
      // Published = committed (which these rows are) and not explicitly unpublished. `published:false`
      // is Setu's only "not published" signal (lifecycle `hidden()`); a frontmatter `status` field is
      // NOT — committed content is live (drafts are DB-only). Matches the site + the health audit.
      if (r.data.published === false) return false
      return true
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, Math.max(0, limit))
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function toFeedItem(row: FeedRow): FeedItem {
  const title = str(row.data.title) || row.id.split('/').slice(2).join('/')
  const description = str(row.data.description) || str(row.data.summary) || excerpt(row.body ?? '')
  return { title, link: `/${toUrlPath(row.id)}`, pubDate: row.date, description }
}

/** Wire Astro entries → resolved dates → selection → feed items. */
export function getFeedPosts(
  entries: { id: string; data: Record<string, unknown>; body?: string; filePath?: string }[],
  limit: number,
): FeedItem[] {
  const rows: FeedRow[] = entries.map((e) => ({
    id: e.id,
    data: e.data,
    body: e.body,
    date: resolvePostDate(e as DatableEntry),
  }))
  return selectFeedPosts(rows, limit).map(toFeedItem)
}
