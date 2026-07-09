/** THE entry-slug vocabulary — shared by minting (admin compose), validation
 *  (rename service), and auto-derive, so any slug the system can mint is also
 *  renameable-to and vice versa. Distinct from the taxonomy slugify
 *  (`taxonomy/ops.ts`), which has different fallback semantics.
 *
 *  Title/slug text → URL-safe entry slug. Lowercase — Unicode letters are KEPT
 *  (`Über uns` → `über-uns`), words joined by single hyphens; drops punctuation.
 *  Returns '' for empty/symbol-only input (callers fall back to 'untitled'). */
export function entrySlugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '') // keep letters, numbers, whitespace, underscore, hyphen
    .replace(/[\s_]+/g, '-') // whitespace + underscores → hyphen separators
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Reserved: the admin's compose-route sentinel (`/edit/<c>/<l>/new`) — never a
 *  real entry identity. */
export const RESERVED_ENTRY_SLUG = 'new'

/** A string is a valid entry slug iff it is non-empty, not the reserved compose
 *  sentinel, and already canonical — a fixed point of `entrySlugify`. Validating
 *  by fixed point (instead of an ASCII regex) keeps the vocabulary in ONE place:
 *  anything minting can produce, this accepts. */
export function isValidEntrySlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug !== RESERVED_ENTRY_SLUG &&
    entrySlugify(slug) === slug
  )
}
