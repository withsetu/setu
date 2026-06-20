import { dump, load } from 'js-yaml'
import type { Category } from './types'

/** Parse `taxonomy/categories.yaml`. Tolerant: empty/absent/malformed → []. A row
 *  needs a string `slug` and `name`; `parent` defaults to null. Never throws. */
export function parseCategories(raw: string): Category[] {
  let data: unknown
  try {
    data = load(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: Category[] = []
  for (const row of data) {
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.slug !== 'string' || typeof r.name !== 'string') continue
    out.push({ slug: r.slug, name: r.name, parent: typeof r.parent === 'string' ? r.parent : null })
  }
  return out
}

/** Serialize categories to YAML. Empty list → empty string (no file content). */
export function serializeCategories(cats: Category[]): string {
  if (cats.length === 0) return ''
  return dump(cats.map((c) => ({ slug: c.slug, name: c.name, parent: c.parent })))
}
