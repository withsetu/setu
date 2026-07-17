/** Category registration for seeded posts (#512). Pack terms are display
 *  names ("Prints and Drawings"); frontmatter `categories` carries slugs from
 *  `taxonomy/categories.yaml`. This module merges the seed's names into the
 *  existing registry using core's own pure taxonomy ops (`addCategory` —
 *  reuse, never a forked slugifier), so the engine can commit the whole file
 *  ONCE instead of one commit per term (the TaxonomyService pattern is
 *  per-mutation by design; wrong for bulk). */
import { addCategory } from '@setu/core'
import type { Category } from '@setu/core'

export interface CategoryMerge {
  /** The full merged registry (existing entries preserved, order kept). */
  cats: Category[]
  /** Slugs newly minted by this merge — what the seed manifest records. */
  addedSlugs: string[]
  /** Case-insensitive display name → slug, for every name passed in. */
  slugByName: Map<string, string>
}

/** Merge display names into an existing registry. A name matching an existing
 *  category's name (case-insensitive) reuses its slug; new names are appended
 *  via `addCategory` (which owns slugify + slug de-duplication). Pure. */
export function mergeCategoryNames(
  existing: Category[],
  names: Iterable<string>
): CategoryMerge {
  let cats = existing
  const addedSlugs: string[] = []
  const slugByName = new Map<string, string>()
  const byLowerName = new Map<string, string>(
    existing.map((c) => [c.name.trim().toLowerCase(), c.slug])
  )
  for (const raw of names) {
    const name = raw.trim()
    if (name === '') continue
    const key = name.toLowerCase()
    const known = byLowerName.get(key)
    if (known !== undefined) {
      slugByName.set(key, known)
      continue
    }
    const { cats: next, slug } = addCategory(cats, { name, parent: null })
    cats = next
    addedSlugs.push(slug)
    byLowerName.set(key, slug)
    slugByName.set(key, slug)
  }
  return { cats, addedSlugs, slugByName }
}
