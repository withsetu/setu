import {
  selectPosts,
  DEFAULT_LOCALE,
  taxonomyArchivePath,
  taxonomyTermLocales,
  type PostRow
} from '@setu/core'
import { bucketPostsByTerm } from './build-cache'

export type TaxonomyKind = 'category' | 'tag'

/** Slash-less archive root (the pagination base ArchiveList appends `/<n>` to), derived from core's
 *  one archive spelling so it cannot drift from the chip href / sitemap `<loc>`. */
export const taxonomyArchiveBasePath = (
  kind: TaxonomyKind,
  slug: string,
  locale: string
): string => taxonomyArchivePath(kind, slug, locale).slice(0, -1)

/** One archive to emit: a term in a locale, its posts (newest first) and the hreflang cluster. */
export interface TaxonomyArchiveGroup {
  locale: string
  slug: string
  posts: PostRow[]
  /** Locale variants of this same term that are ALSO emitted (slash-less archive roots). Fewer
   *  than 2 → empty, since a lone hreflang is meaningless. */
  alternates: { locale: string; path: string }[]
}

const pickOf = (kind: TaxonomyKind) => (p: PostRow) =>
  kind === 'category' ? p.categories : p.tags

/**
 * The taxonomy archives the site emits, as pure data — the single enumeration behind both the
 * unprefixed `/tag|category/<slug>/` routes (`scope: 'default'`) and the per-locale
 * `/<locale>/tag|category/<slug>/` routes (`scope: 'localized'`, every non-default locale) (#1114).
 * A group exists only for a term with ≥1 published post in that locale, so the routes are bounded
 * by real (locale, term) pairs and a chip on a post always has an archive to land on.
 *
 * Per locale it is the #858 shape: one filter+sort, then one O(posts) bucketing pass. Groups come
 * back locale-sorted (default first) then slug-sorted, matching the old per-slug enumeration for
 * the default locale. Enforced by apps/site/test/taxonomy-archive-paths.test.ts and, against the
 * built site, apps/site/test/taxonomy-archive.test.ts.
 */
export function taxonomyArchiveGroups(
  rows: PostRow[],
  kind: TaxonomyKind,
  scope: 'default' | 'localized'
): TaxonomyArchiveGroup[] {
  const pick = pickOf(kind)
  const termLocales = taxonomyTermLocales(rows, pick)
  const locales = [
    ...new Set(
      rows
        .filter((r) => r.collection === 'post' && r.published !== false)
        .map((r) => r.locale)
    )
  ]
    .filter((l) =>
      scope === 'default' ? l === DEFAULT_LOCALE : l !== DEFAULT_LOCALE
    )
    .sort((a, b) => a.localeCompare(b))
  return locales.flatMap((locale) => {
    const published = selectPosts(rows, {
      collection: 'post',
      locale,
      sort: 'newest',
      limit: rows.length,
      offset: 0
    })
    const buckets = bucketPostsByTerm(published, pick)
    return [...buckets.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((slug) => {
        const variants = termLocales.get(slug) ?? []
        return {
          locale,
          slug,
          posts: buckets.get(slug)!,
          alternates:
            variants.length < 2
              ? []
              : variants.map((l) => ({
                  locale: l,
                  path: taxonomyArchiveBasePath(kind, slug, l)
                }))
        }
      })
  })
}
