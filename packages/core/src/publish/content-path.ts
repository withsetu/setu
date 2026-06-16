import type { EntryRef } from '../data/types'

/** Repo-relative path for an entry's Markdoc file:
 *  `content/<collection>/<locale>/<slug>.mdoc`. */
export function contentPath(ref: EntryRef): string {
  return `content/${ref.collection}/${ref.locale}/${ref.slug}.mdoc`
}

/** Inverse of `contentPath`: parse `content/<collection>/<locale>/<slug>.mdoc`
 *  into an `EntryRef`. Returns null for any path that does not match exactly
 *  (wrong root, wrong extension, wrong segment count, empty segment). */
export function parseContentPath(path: string): EntryRef | null {
  const match = /^content\/([^/]+)\/([^/]+)\/([^/]+)\.mdoc$/.exec(path)
  if (match === null) return null
  const [, collection, locale, slug] = match
  if (!collection || !locale || !slug) return null
  return { collection, locale, slug }
}
