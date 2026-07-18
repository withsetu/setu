import type { EntryRef } from '../data/types'
import type { LifecycleState, LifecyclePending } from '../lifecycle/derive'
import type { ContentRow } from '../content-index/list-entries'

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
  /** `featuredImage` present and non-blank — the list indicator/filter surface (#576). */
  hasFeaturedImage: boolean
  /** Frontmatter `seo:` block sets any override — indicator only, never values (#577). */
  hasSeoOverrides: boolean
}

export type SortKey = 'updatedAt' | 'title' | 'status' | 'locale'

export interface IndexQuery {
  collection: string
  q?: string
  status?: LifecycleState
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
  version: number
}

export interface IndexPort {
  query(q: IndexQuery): Promise<{ rows: EntryIndexRow[]; total: number }>
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
    ...(r.featuredImage !== undefined
      ? { featuredImage: r.featuredImage }
      : {}),
    hasFeaturedImage: r.hasFeaturedImage,
    hasSeoOverrides: r.hasSeoOverrides
  }
}
