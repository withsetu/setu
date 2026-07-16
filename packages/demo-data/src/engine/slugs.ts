/** Slug assignment for seeded posts (#512). Uses core's `entrySlugify` — THE
 *  entry-slug vocabulary — so every seeded slug is one the admin could have
 *  minted itself. Collisions (against the repo's existing entries and within
 *  the seed batch) are disambiguated with the pack post's stable id, keeping
 *  assignment deterministic across runs. */
import { entrySlugify } from '@setu/core'

/** Cap the slug base: real AIC titles run past OS filename limits (a 1000-post
 *  live seed hit ENAMETOOLONG on a 300+ char title, 2026-07-16). 80 chars keeps
 *  `<slug>-<packId>-<n>.mdoc` comfortably under every filesystem's 255-byte
 *  cap; trimming lands on a word boundary so the slug stays readable — and
 *  stays a fixed point of `entrySlugify` (a valid entry slug). */
export const MAX_SLUG_BASE = 80

function capSlug(slug: string): string {
  if (slug.length <= MAX_SLUG_BASE) return slug
  const cut = slug.slice(0, MAX_SLUG_BASE)
  const lastHyphen = cut.lastIndexOf('-')
  return (
    lastHyphen > MAX_SLUG_BASE / 2 ? cut.slice(0, lastHyphen) : cut
  ).replace(/-$/, '')
}

/** Mint a unique slug for `title`, avoiding everything in `taken`; the chosen
 *  slug is added to `taken`. Collision ladder: `<base>` → `<base>-<packId>` →
 *  `<base>-<packId>-2` → … (pack ids are stable, so the same input yields the
 *  same slug on every run). */
export function uniqueEntrySlug(
  title: string,
  packId: string,
  taken: Set<string>
): string {
  const base = capSlug(entrySlugify(title)) || 'untitled'
  let candidate = base
  if (taken.has(candidate)) {
    const suffixed = `${base}-${entrySlugify(packId) || 'x'}`
    candidate = suffixed
    for (let n = 2; taken.has(candidate); n++) candidate = `${suffixed}-${n}`
  }
  taken.add(candidate)
  return candidate
}
