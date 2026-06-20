import { normalizeTag } from '../tags/normalize'

type Meta = Record<string, unknown>

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Add a category slug to `meta.categories` (deduped). No-op (same ref) if present. */
export function addCategory(meta: Meta, slug: string): Meta {
  const cats = asStringArray(meta['categories'])
  if (cats.includes(slug)) return meta
  return { ...meta, categories: [...cats, slug] }
}

/** Remove a category slug. No-op (same ref) if absent. */
export function removeCategory(meta: Meta, slug: string): Meta {
  const cats = asStringArray(meta['categories'])
  if (!cats.includes(slug)) return meta
  return { ...meta, categories: cats.filter((c) => c !== slug) }
}

/** Normalize `rawTag` and add to `meta.tags` (deduped). No-op if empty-after-normalize or present. */
export function addTag(meta: Meta, rawTag: string): Meta {
  const tag = normalizeTag(rawTag)
  if (!tag) return meta
  const tags = asStringArray(meta['tags'])
  if (tags.includes(tag)) return meta
  return { ...meta, tags: [...tags, tag] }
}

/** Normalize `rawTag` and remove from `meta.tags`. No-op if empty-after-normalize or absent. */
export function removeTag(meta: Meta, rawTag: string): Meta {
  const tag = normalizeTag(rawTag)
  if (!tag) return meta
  const tags = asStringArray(meta['tags'])
  if (!tags.includes(tag)) return meta
  return { ...meta, tags: tags.filter((t) => t !== tag) }
}
