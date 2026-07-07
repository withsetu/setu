import type { EntryIndexRow } from './types'

export interface MediaUsage {
  collection: string
  locale: string
  slug: string
  title: string
}

/** Entries whose mediaRefs include `mediaKey`. The shared impl for every adapter
 *  (cf. selectDistinctTags). */
export function selectReferencedBy(
  rows: EntryIndexRow[],
  mediaKey: string
): MediaUsage[] {
  const out: MediaUsage[] = []
  for (const r of rows) {
    if (r.mediaRefs.includes(mediaKey))
      out.push({
        collection: r.collection,
        locale: r.locale,
        slug: r.slug,
        title: r.title
      })
  }
  return out
}
