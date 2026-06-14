import type { EntryRef } from '../data/types'

/** Repo-relative path for an entry's Markdoc file:
 *  `content/<collection>/<locale>/<slug>.mdoc`. */
export function contentPath(ref: EntryRef): string {
  return `content/${ref.collection}/${ref.locale}/${ref.slug}.mdoc`
}
