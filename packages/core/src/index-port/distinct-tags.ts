import type { EntryIndexRow } from './types'

/** True when `tag` starts with `prefix`, compared case-insensitively. Exported
 *  because the admin's draft overlay (apps/admin/src/data/http-index-service.ts)
 *  filters draft tags with the same rule and previously kept its own copy, which
 *  drifted into the same prefix-only fold as this module's (#895) — one predicate,
 *  one test (packages/core/src/index-port/distinct-tags.test.ts). `prefix` is
 *  folded and trimmed here, so callers pass it raw. */
export function tagMatchesPrefix(tag: string, prefix: string): boolean {
  return tag.toLowerCase().startsWith(prefix.toLowerCase().trim())
}

/** Distinct tags across rows whose value starts with the prefix, compared
 *  case-insensitively and returned in their original casing; sorted ascending,
 *  capped at `limit`. Empty prefix → first `limit` tags. The single filter/sort
 *  impl, shared by every IndexPort adapter (cf. runQuery).
 *
 *  Both sides are folded, not just the prefix: folding only the prefix made every
 *  capitalised tag unreachable by every non-empty prefix (#895). Rows built by
 *  `tagsOf` (content-index/list-entries.ts) are already lowercase via
 *  `normalizeTags`, so that was latent rather than user-visible — but this is an
 *  exported helper over an `EntryIndexRow[]` whose `tags` the type does not
 *  constrain to lowercase, so it must not depend on the caller having folded.
 *  Enforced by packages/core/src/index-port/distinct-tags.test.ts and, across all
 *  three adapters, by the `distinctTags` cases in packages/db-testing/src/index.ts. */
export function selectDistinctTags(
  rows: EntryIndexRow[],
  prefix: string,
  limit: number
): string[] {
  const set = new Set<string>()
  for (const r of rows)
    for (const t of r.tags) if (tagMatchesPrefix(t, prefix)) set.add(t)
  return [...set].sort().slice(0, limit)
}

/** Distinct locales across rows, sorted ascending. Locales are a tiny bounded
 *  set, so no prefix/limit — the whole list feeds a filter dropdown. */
export function selectDistinctLocales(rows: EntryIndexRow[]): string[] {
  const set = new Set<string>()
  for (const r of rows) set.add(r.locale)
  return [...set].sort()
}
