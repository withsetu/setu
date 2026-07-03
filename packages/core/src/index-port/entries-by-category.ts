import type { EntryRef } from '../data/types'
import type { EntryIndexRow } from './types'

/** Refs of every entry whose categories include `slug` (across collections/locales).
 *  Shared pure impl for every IndexPort adapter (cf. selectReferencedBy). */
export function selectEntriesByCategory(
  rows: EntryIndexRow[],
  slug: string
): EntryRef[] {
  return rows
    .filter((r) => r.categories.includes(slug))
    .map((r) => ({ collection: r.collection, locale: r.locale, slug: r.slug }))
}
