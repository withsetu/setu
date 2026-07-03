import type { PostRow } from './select-posts'
import type { Category } from '../taxonomy/types'

function distinct(
  rows: PostRow[],
  locale: string,
  pick: (r: PostRow) => string[]
): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    if (r.collection !== 'post' || r.locale !== locale) continue
    for (const v of pick(r)) if (v) set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Category slugs appearing on a post in `locale`, deduped + sorted. Drives archive getStaticPaths. */
export function distinctCategorySlugs(
  rows: PostRow[],
  locale: string
): string[] {
  return distinct(rows, locale, (r) => r.categories)
}

/** Tags appearing on a post in `locale`, deduped + sorted. */
export function distinctTagSlugs(rows: PostRow[], locale: string): string[] {
  return distinct(rows, locale, (r) => r.tags)
}

/** slug → display name from categories.yaml rows. */
export function categoryNameMap(categories: Category[]): Map<string, string> {
  return new Map(categories.map((c) => [c.slug, c.name]))
}
