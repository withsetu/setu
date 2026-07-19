import type { EntryRef } from '../data/types'
import type { LifecycleState, LifecyclePending } from '../lifecycle/derive'
import type { ContentRow, EntryAuditFacts } from '../content-index/list-entries'
import type { IndexStats } from './stats'

export type { EntryAuditFacts }

export interface EntryIndexRow {
  key: string
  collection: string
  locale: string
  slug: string
  title: string
  titleLower: string
  status: LifecycleState
  pending?: LifecyclePending
  updatedAt: number | null
  hasDraft: boolean
  /** Frontmatter publish date (`date` ?? `pubDate`), epoch ms; null when absent. */
  date: number | null
  tags: string[]
  categories: string[]
  mediaRefs: string[]
  featuredImage?: string
  /** Site Health content-audit facts (#593), precomputed from the COMMITTED
   *  content at index time (draft-blind, matching the old git-walk audit) so the
   *  content scan reads them via `selectAuditSummary` instead of re-walking Git. */
  audit: EntryAuditFacts
  /** `featuredImage` present and non-blank — the list indicator/filter surface (#576). */
  hasFeaturedImage: boolean
  /** Frontmatter `seo:` block sets any override — indicator only, never values (#577). */
  hasSeoOverrides: boolean
}

export type SortKey = 'updatedAt' | 'title' | 'status' | 'locale'

/** What `IndexQuery.status` accepts: any exact `LifecycleState`, plus two
 *  combined pseudo-states — `'published'` = staged OR live (#579) and
 *  `'not-published'` = draft OR unpublished (#611).
 *
 *  Both are FILTER vocabulary words, never a row's `status` — an entry is stored
 *  as exactly one lifecycle state. 'published' exists because "published"
 *  (committed + `published !== false`) spans two lifecycle states that differ
 *  only in whether a deploy has happened yet: `staged` (committed, not deployed)
 *  and `live` (deployed). 'not-published' is its exact complement, and exists for
 *  the same reason in reverse: "not on the site" also spans two states that
 *  differ only by deploy history — `draft` (hidden, never deployed) and
 *  `unpublished` (hidden, but was deployed once, so the site still shows it until
 *  the next deploy). The dashboard's Drafts tile counts that union, so it needs a
 *  filter that selects it (#611); the Live/Staged tiles deep-link to exact states.
 *
 *  The two unions PARTITION the four lifecycle states: every entry is in exactly
 *  one. That is what lets the dashboard assert Live + Staged + Drafts ===
 *  Posts + Pages. */
export type IndexStatusFilter = LifecycleState | 'published' | 'not-published'

/** Every value `IndexQuery.status` accepts — the single source of truth shared by
 *  the API's Zod boundary and the admin list's URL-param validation, so a new
 *  state can never be accepted in one place and silently dropped in another. */
export const INDEX_STATUS_FILTERS = [
  'draft',
  'staged',
  'live',
  'unpublished',
  'published',
  'not-published'
] as const satisfies readonly IndexStatusFilter[]

/** True when `s` is a status the index can filter on — used to reject junk from
 *  URLs/query strings instead of passing it through to a silent empty result. */
export const isIndexStatusFilter = (s: string): s is IndexStatusFilter =>
  (INDEX_STATUS_FILTERS as readonly string[]).includes(s)

/** Does a row's lifecycle state satisfy `filter`? The ONE place the union
 *  pseudo-states are expanded — `runQuery` and any future SQL-native adapter
 *  must agree. */
export const matchesStatusFilter = (
  state: LifecycleState,
  filter: IndexStatusFilter
): boolean => {
  if (filter === 'published') return state === 'staged' || state === 'live'
  if (filter === 'not-published')
    return state === 'draft' || state === 'unpublished'
  return state === filter
}

export interface IndexQuery {
  /** Restrict to one collection. OMIT for the cross-collection scope: every
   *  collection at once (#604). The dashboard's status tiles count post + page
   *  together, so their destination list must be able to show both — a tile whose
   *  number can't be reproduced by the list it links to is a bug, not a nuance. */
  collection?: string
  q?: string
  /** Exact lifecycle state, or a union: `'published'` = staged+live (#579),
   *  `'not-published'` = draft+unpublished (#611). */
  status?: IndexStatusFilter
  locale?: string
  tag?: string
  category?: string
  /** true → only entries with a featured image; false → only those without (#576). */
  hasFeaturedImage?: boolean
  /** true → only entries with custom SEO overrides; false → only those without (#577). */
  hasSeoOverrides?: boolean
  sort?: { key: SortKey; dir: 'asc' | 'desc' }
  offset: number
  limit: number
}

export interface IndexMeta {
  indexedSha: string | null
  /** The deploy whose live/staged projection every row currently reflects (#662).
   *  The index is PERSISTENT but this used to be session-scoped, so an out-of-band
   *  deploy (CI, a Pages hook, another session) plus a restart left every row's
   *  live-vs-staged state wrong until someone hit `POST /api/index/refresh`.
   *  Persisting it lets `ensureBuilt` notice `!== deploy().deployedSha` and run the
   *  deploy diff on its own. Null = no deploy absorbed yet. */
  deployedSha: string | null
  version: number
}

export interface IndexPort {
  query(q: IndexQuery): Promise<{ rows: EntryIndexRow[]; total: number }>
  /** Per-collection lifecycle tallies in ONE call over body-free rows — the
   *  dashboard's At-a-glance counts (#587). */
  stats(): Promise<IndexStats>
  upsert(row: EntryIndexRow): Promise<void>
  upsertMany(rows: EntryIndexRow[]): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  getMeta(): Promise<IndexMeta>
  setMeta(meta: IndexMeta): Promise<void>
  distinctTags(prefix: string, limit: number): Promise<string[]>
  distinctLocales(): Promise<string[]>
  categoryCounts(): Promise<Record<string, number>>
  tagCounts(): Promise<Record<string, number>>
  referencedBy(
    mediaKey: string
  ): Promise<import('./referenced-by').MediaUsage[]>
  entriesByCategory(slug: string): Promise<import('../data/types').EntryRef[]>
  entriesByTag(tag: string): Promise<import('../data/types').EntryRef[]>
  /** Body-free Site Health content facts, rolled up from every row's precomputed
   *  audit facts (#593). */
  auditSummary(): Promise<import('./audit-summary').AuditSummary>
}

export const indexKey = (ref: EntryRef): string =>
  `${ref.collection}\0${ref.locale}\0${ref.slug}`

export function projectRow(row: ContentRow): EntryIndexRow {
  const out: EntryIndexRow = {
    key: indexKey(row.ref),
    collection: row.ref.collection,
    locale: row.ref.locale,
    slug: row.ref.slug,
    title: row.title,
    titleLower: row.title.toLowerCase(),
    status: row.lifecycle.state,
    updatedAt: row.updatedAt,
    hasDraft: row.hasDraft,
    date: row.date,
    tags: row.tags,
    categories: row.categories,
    mediaRefs: row.mediaRefs,
    audit: row.audit,
    hasFeaturedImage: row.hasFeaturedImage,
    hasSeoOverrides: row.hasSeoOverrides
  }
  if (row.lifecycle.pending !== undefined) out.pending = row.lifecycle.pending
  if (row.featuredImage !== undefined) out.featuredImage = row.featuredImage
  return out
}

export function rowToContentRow(r: EntryIndexRow): ContentRow {
  const lifecycle =
    r.pending !== undefined
      ? { state: r.status, pending: r.pending }
      : { state: r.status }
  return {
    ref: { collection: r.collection, locale: r.locale, slug: r.slug },
    title: r.title,
    locale: r.locale,
    lifecycle,
    updatedAt: r.updatedAt,
    hasDraft: r.hasDraft,
    date: r.date,
    tags: r.tags,
    categories: r.categories,
    mediaRefs: r.mediaRefs,
    audit: r.audit,
    ...(r.featuredImage !== undefined
      ? { featuredImage: r.featuredImage }
      : {}),
    hasFeaturedImage: r.hasFeaturedImage,
    hasSeoOverrides: r.hasSeoOverrides
  }
}
