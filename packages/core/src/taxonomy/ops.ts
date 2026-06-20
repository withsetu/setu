import type { Category } from './types'

export type TaxonomyErrorCode = 'parent-not-found' | 'not-found' | 'cycle' | 'empty-name'

/** A validation failure from a taxonomy op. `code` lets the UI show a message. */
export class TaxonomyError extends Error {
  code: TaxonomyErrorCode
  constructor(code: TaxonomyErrorCode, message: string) {
    super(message)
    this.name = 'TaxonomyError'
    this.code = code
  }
}

/** Name → URL-safe slug. Keeps letters/numbers, hyphenates the rest; 'category'
 *  when nothing survives. (Mirrors the editor's entry slugify.) */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'category'
}

const uniqueSlug = (base: string, taken: Set<string>): string => {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Append a new category. Slugified + de-duplicated. Throws if `parent` is set
 *  but absent. Returns the new list and the minted slug. */
export function addCategory(
  cats: Category[],
  input: { name: string; parent: string | null },
): { cats: Category[]; slug: string } {
  const trimmed = input.name.trim()
  if (trimmed === '') throw new TaxonomyError('empty-name', 'Category name cannot be empty')
  if (input.parent !== null && !cats.some((c) => c.slug === input.parent)) {
    throw new TaxonomyError('parent-not-found', `Parent "${input.parent}" does not exist`)
  }
  const slug = uniqueSlug(slugify(trimmed), new Set(cats.map((c) => c.slug)))
  return { cats: [...cats, { slug, name: trimmed, parent: input.parent }], slug }
}

/** Change a category's display name only (posts reference the slug, untouched). */
export function renameLabel(cats: Category[], slug: string, name: string): Category[] {
  if (!cats.some((c) => c.slug === slug)) throw new TaxonomyError('not-found', `Category "${slug}" does not exist`)
  const trimmed = name.trim()
  if (trimmed === '') throw new TaxonomyError('empty-name', 'Category name cannot be empty')
  return cats.map((c) => (c.slug === slug ? { ...c, name: trimmed } : c))
}

/** Move a category under a new parent (or null for root). Throws on missing
 *  slug/parent, self-parent, or a move that would create a cycle. */
export function reparent(cats: Category[], slug: string, parent: string | null): Category[] {
  if (!cats.some((c) => c.slug === slug)) throw new TaxonomyError('not-found', `Category "${slug}" does not exist`)
  if (parent !== null) {
    if (!cats.some((c) => c.slug === parent)) {
      throw new TaxonomyError('parent-not-found', `Parent "${parent}" does not exist`)
    }
    const bySlug = new Map(cats.map((c) => [c.slug, c]))
    let p: string | null = parent
    while (p !== null) {
      if (p === slug) throw new TaxonomyError('cycle', 'Move would create a cycle')
      p = bySlug.get(p)?.parent ?? null
    }
  }
  return cats.map((c) => (c.slug === slug ? { ...c, parent } : c))
}
