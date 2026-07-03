/** Minimal row the related-posts scorer needs — a projection of EntryIndexRow or any
 *  build-time content row. `key` is an opaque caller-chosen identity (the admin uses
 *  indexKey; the site build uses the Astro entry id "<collection>/<locale>/<slug>"). */
export interface RelatedRow {
  key: string
  collection: string
  locale: string
  slug: string
  title: string
  tags: string[]
  categories: string[]
  updatedAt: number | null
}

/** A resolved related entry. `title` is included so consumers need no second lookup. */
export interface RelatedRef {
  collection: string
  locale: string
  slug: string
  title: string
}

export interface RelatedOpts {
  /** How many related entries per source. Default 4. */
  k?: number
  /** Weight on shared-category Jaccard, added to shared-tag Jaccard. Default 0.25. */
  categoryBoost?: number
}

/** Jaccard set similarity |A∩B| / |A∪B|; 0 when both sets are empty. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

const refOf = (r: RelatedRow): RelatedRef => ({
  collection: r.collection,
  locale: r.locale,
  slug: r.slug,
  title: r.title
})

/** Total order: recency desc (null treated as oldest), then key asc — deterministic. */
function byRecencyThenKey(a: RelatedRow, b: RelatedRow): number {
  const ua = a.updatedAt ?? -Infinity
  const ub = b.updatedAt ?? -Infinity
  if (ua !== ub) return ub - ua
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Build a related-posts map: each source `key` → its top-`k` related entries.
 *
 * - Candidates are scoped to the SAME collection and locale; the source is excluded.
 * - Primary ranking: jaccard(tags) + categoryBoost*jaccard(categories), descending.
 * - Ties broken by recency (updatedAt desc), then key (asc) — deterministic output.
 * - Candidate generation uses an inverted tag index (only rows sharing ≥1 tag are
 *   scored), so it is near-linear for sparse tag overlap — not O(N²) all-pairs.
 * - Graceful fallback fills unused slots: same-category peers (by recency), then the
 *   most-recent in the same collection+locale — so a source is never left short when
 *   other in-scope rows exist.
 *
 * Pure: no I/O, no clock (recency comes from each row's updatedAt). This is the swap
 * seam for a future embedding-based scorer (identical output shape).
 */
export function selectRelatedPosts(
  rows: RelatedRow[],
  opts: RelatedOpts = {}
): Record<string, RelatedRef[]> {
  const k = opts.k ?? 4
  const categoryBoost = opts.categoryBoost ?? 0.25

  const byTag = new Map<string, RelatedRow[]>()
  for (const r of rows) {
    for (const t of r.tags) {
      const list = byTag.get(t)
      if (list) list.push(r)
      else byTag.set(t, [r])
    }
  }

  const out: Record<string, RelatedRef[]> = {}

  for (const src of rows) {
    const inScope = (c: RelatedRow): boolean =>
      c.key !== src.key &&
      c.collection === src.collection &&
      c.locale === src.locale

    // Candidate set: in-scope rows sharing ≥1 tag with src, deduped by key.
    const candByKey = new Map<string, RelatedRow>()
    for (const t of src.tags) {
      for (const c of byTag.get(t) ?? [])
        if (inScope(c)) candByKey.set(c.key, c)
    }

    const scored = [...candByKey.values()]
      .map((c) => ({
        c,
        score:
          jaccard(src.tags, c.tags) +
          categoryBoost * jaccard(src.categories, c.categories)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || byRecencyThenKey(a.c, b.c))

    const picked: RelatedRow[] = scored.slice(0, k).map((x) => x.c)
    const pickedKeys = new Set(picked.map((r) => r.key))

    // Fallback only when no tag-scored results exist (scored is empty).
    if (scored.length === 0) {
      const srcCats = new Set(src.categories)
      const tier1 = rows
        .filter(
          (c) =>
            inScope(c) &&
            !pickedKeys.has(c.key) &&
            c.categories.some((g) => srcCats.has(g))
        )
        .sort(byRecencyThenKey)
      for (const c of tier1) {
        if (picked.length >= k) break
        picked.push(c)
        pickedKeys.add(c.key)
      }

      const tier2 = rows
        .filter((c) => inScope(c) && !pickedKeys.has(c.key))
        .sort(byRecencyThenKey)
      for (const c of tier2) {
        if (picked.length >= k) break
        picked.push(c)
        pickedKeys.add(c.key)
      }
    }

    out[src.key] = picked.map(refOf)
  }

  return out
}
