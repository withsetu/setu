import { DEFAULT_LOCALE, excerpt } from '@setu/core'
import { resolvePostDate, type DatableEntry } from './post-date'
import { toUrlPath } from './url'

// `excerpt` now lives in @setu/core (shared with the posts/query block render). Re-exported so
// existing importers (and feed.test) keep their `from './feed'` path unchanged.
export { excerpt }

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

/** Pure: keep published posts for `locale`, newest first, capped at `limit`. */
export function selectFeedPosts(rows: FeedRow[], limit: number, locale: string = DEFAULT_LOCALE): FeedRow[] {
  return rows
    .filter((r) => {
      const [collection, loc] = r.id.split('/')
      if (collection !== 'post' || loc !== locale) return false
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
  locale: string = DEFAULT_LOCALE,
): FeedItem[] {
  const rows: FeedRow[] = entries.map((e) => ({
    id: e.id,
    data: e.data,
    body: e.body,
    date: resolvePostDate(e as DatableEntry),
  }))
  return selectFeedPosts(rows, limit, locale).map(toFeedItem)
}

/** Distinct locales that have at least one published post, default locale first. */
export function feedLocales(entries: { id: string; data: Record<string, unknown> }[]): string[] {
  const set = new Set<string>()
  for (const e of entries) {
    const [collection, locale] = e.id.split('/')
    if (collection !== 'post' || !locale) continue
    if (e.data.published === false) continue
    set.add(locale)
  }
  return [...set].sort((a, b) =>
    a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b),
  )
}
