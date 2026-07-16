/** Slug assignment for seeded posts (#512). Uses core's `entrySlugify` — THE
 *  entry-slug vocabulary — so every seeded slug is one the admin could have
 *  minted itself. Collisions (against the repo's existing entries and within
 *  the seed batch) are disambiguated with the pack post's stable id, keeping
 *  assignment deterministic across runs. */
import { entrySlugify } from '@setu/core'

/** Mint a unique slug for `title`, avoiding everything in `taken`; the chosen
 *  slug is added to `taken`. Collision ladder: `<base>` → `<base>-<packId>` →
 *  `<base>-<packId>-2` → … (pack ids are stable, so the same input yields the
 *  same slug on every run). */
export function uniqueEntrySlug(
  title: string,
  packId: string,
  taken: Set<string>
): string {
  const base = entrySlugify(title) || 'untitled'
  let candidate = base
  if (taken.has(candidate)) {
    const suffixed = `${base}-${entrySlugify(packId) || 'x'}`
    candidate = suffixed
    for (let n = 2; taken.has(candidate); n++) candidate = `${suffixed}-${n}`
  }
  taken.add(candidate)
  return candidate
}
