import type { EntryRef } from '../data/types'
import type { EntryIndexRow } from './types'

/** Refs of every entry whose tags include `tag` (across collections/locales).
 *  Shared pure impl for every IndexPort adapter (cf. selectEntriesByCategory). */
export function selectEntriesByTag(
  rows: EntryIndexRow[],
  tag: string
): EntryRef[] {
  return rows
    .filter((r) => r.tags.includes(tag))
    .map((r) => ({ collection: r.collection, locale: r.locale, slug: r.slug }))
}
