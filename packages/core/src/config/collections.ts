import { z, type ZodTypeAny } from 'zod'
import type { CollectionDefinition, ResolvedCollection } from './types'

/** Duck-typed ZodObject check. `instanceof` is avoided here for the same reason
 *  `schema.ts`'s `isZodSchema` avoids it: a dual zod instance (two copies in the tree)
 *  makes `instanceof` fail on a perfectly valid schema. */
export const isZodObject = (val: unknown): val is ZodTypeAny =>
  typeof (val as { safeParse?: unknown })?.safeParse === 'function' &&
  typeof (val as { shape?: unknown })?.shape === 'object' &&
  (val as { shape?: unknown }).shape !== null

/** Collection names that would collide with a site route namespace
 *  (`/category/<slug>`, `/tag/<slug>` in `apps/site/src/pages/`). */
export const RESERVED_COLLECTION_NAMES: ReadonlySet<string> = new Set([
  'category',
  'tag'
])

/**
 * Fields every entry may carry regardless of collection, mirroring what the system
 * already reads out of frontmatter today: `list-entries.ts` (title/published/categories/
 * tags/featuredImage), `permalinks/frontmatter-date.ts` (date), and the editor's MetaPanel.
 *
 * All optional **by design, for now**: this schema is intended to be behaviour-neutral for
 * existing content, which carries entries with no title and no date. Tightening any field to
 * required is deferred to the increment that can surface the error in the admin (#963) —
 * requiring a field the UI cannot show an error for would only fail saves with no way to fix
 * them. An author may still override any of these per collection; a declared field wins over
 * the base one (`packages/core/test/config/collections.test.ts`).
 *
 * `date` admits a `Date` because js-yaml parses an unquoted ISO date into one.
 */
export const BASE_ENTRY_FIELDS = z.object({
  title: z.string().optional(),
  date: z.union([z.string(), z.date()]).optional(),
  published: z.boolean().optional(),
  excerpt: z.string().optional(),
  featuredImage: z.string().optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
})

/** `case-study` → `Case Study`. Separators are `-` and `_`. */
export function humanizeCollectionName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Naive English pluralization of a label's last word — good enough for a default an
 *  author can always override with an explicit `labelPlural`. */
export function pluralizeLabel(label: string): string {
  const idx = label.lastIndexOf(' ')
  const head = idx === -1 ? '' : label.slice(0, idx + 1)
  const word = idx === -1 ? label : label.slice(idx + 1)
  if (/[^aeiouAEIOU]y$/.test(word)) return `${head}${word.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${head}${word}es`
  return `${head}${word}s`
}

/** Fill in derived label/taxonomy defaults and precompute the validation schema
 *  (base fields + declared fields, passthrough). */
export function resolveCollection(
  def: CollectionDefinition
): ResolvedCollection {
  const label = def.label ?? humanizeCollectionName(def.name)
  const declared = def.fields
  // .passthrough(): undeclared frontmatter keys (`pubDate`, theme-specific keys) survive
  // validation untouched — asserted by 'preserves undeclared frontmatter keys' in
  // packages/core/test/config/collections.test.ts.
  const schema = (
    declared
      ? BASE_ENTRY_FIELDS.merge(declared as typeof BASE_ENTRY_FIELDS)
      : BASE_ENTRY_FIELDS
  ).passthrough()
  return {
    name: def.name,
    label,
    labelPlural: def.labelPlural ?? pluralizeLabel(label),
    taxonomies: def.taxonomies ?? [],
    ...(declared ? { fields: declared } : {}),
    schema
  }
}

/** The collections Setu ships with. They are ordinary declared collections, not special
 *  cases — an author may override either by declaring one of the same name (#253). */
export const DEFAULT_COLLECTIONS: CollectionDefinition[] = [
  {
    name: 'post',
    label: 'Post',
    labelPlural: 'Posts',
    taxonomies: ['category', 'tag']
  },
  { name: 'page', label: 'Page', labelPlural: 'Pages', taxonomies: [] }
]

export interface FieldError {
  /** Dotted path to the offending field; `''` for a whole-metadata error. */
  path: string
  message: string
}

export type MetadataValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: FieldError[] }

/**
 * Validate one entry's frontmatter against its collection's schema.
 *
 * Fails closed on an undeclared collection: a caller that cannot name the content type is
 * not permitted to write it ('fails closed for an undeclared collection' in
 * packages/core/test/config/collections.test.ts).
 *
 * Pure — no I/O, no port access — so it is safe on every topology and callable from the
 * write path (increment B) and the admin alike.
 */
export function validateEntryMetadata(
  config: { collectionsByName: Map<string, ResolvedCollection> },
  collection: string,
  metadata: unknown
): MetadataValidation {
  const resolved = config.collectionsByName.get(collection)
  if (!resolved) {
    return {
      ok: false,
      errors: [{ path: '', message: `Unknown collection "${collection}"` }]
    }
  }
  const parsed = resolved.schema.safeParse(metadata)
  if (parsed.success) {
    return { ok: true, value: parsed.data as Record<string, unknown> }
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message
    }))
  }
}
