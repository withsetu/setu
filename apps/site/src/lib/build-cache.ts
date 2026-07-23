import type { PostRow } from '@setu/core'
import { feedLocales } from './feed'

// Build-time helpers for the static-generation hot paths (#858). Two of these hold module-level
// memos: a `.astro` file's frontmatter re-runs on EVERY page render, so any state that must
// persist across renders lives HERE (an ES module is evaluated once per build worker), never as a
// top-level `const` in the page frontmatter. Keyed on the collection name so distinct collections
// never collide; only `'entries'` is used today. Imported ONLY by the site's static routes.

/**
 * Group already-published, already-sorted posts by taxonomy term in a single O(posts) pass.
 * `posts` MUST be pre-sorted (e.g. `selectPosts(rows, { sort: 'newest', … })`): iterating in order
 * means each bucket inherits that order, so `paginate(bucket, …)` is byte-identical to the old
 * per-slug `selectPosts(rows, { category/tag: term, … })`. Terms are deduped per post (matching
 * `Array.includes`, so a post repeating a term still lands in that bucket exactly once) and empty
 * terms are skipped (matching `distinctCategorySlugs`/`distinctTagSlugs`). Buckets come back in
 * first-seen order; callers sort the keys for stable path output. Equivalence to the old
 * selectPosts-per-slug enumeration is enforced by apps/site/test/build-cache.test.ts.
 */
export function bucketPostsByTerm(
  posts: PostRow[],
  pick: (p: PostRow) => string[]
): Map<string, PostRow[]> {
  const buckets = new Map<string, PostRow[]>()
  for (const post of posts) {
    const seen = new Set<string>()
    for (const term of pick(post)) {
      if (!term || seen.has(term)) continue
      seen.add(term)
      let bucket = buckets.get(term)
      if (!bucket) buckets.set(term, (bucket = []))
      bucket.push(post)
    }
  }
  return buckets
}

const feedLocalesCache = new Map<string, string[]>()

/**
 * Site-invariant `feedLocales(...)` result, memoized per collection. The mapping to
 * `{ id, data }` runs only on a cache miss, so repeat page renders pay nothing. Result is
 * identical to calling `feedLocales` directly (verified in apps/site/test/build-cache.test.ts).
 */
export function memoFeedLocales(
  key: string,
  entries: readonly { id: string; data: unknown }[]
): string[] {
  let cached = feedLocalesCache.get(key)
  if (!cached) {
    cached = feedLocales(
      entries.map((e) => ({
        id: e.id,
        data: e.data as Record<string, unknown>
      }))
    )
    feedLocalesCache.set(key, cached)
  }
  return cached
}

const entryIndexCache = new Map<string, Map<string, unknown>>()

/**
 * Site-invariant id → entry index, memoized per collection, for the hreflang-alternates filter
 * (an O(entries) `Array.find` per alternate per page → one `Map.get`). First id per duplicate wins,
 * matching `Array.find`'s first-match semantics (collection entry ids are unique in practice, so
 * this only guards a hypothetical). Behaviour parity is enforced by
 * apps/site/test/build-cache.test.ts.
 */
export function memoEntryIndex<T extends { id: string }>(
  key: string,
  entries: readonly T[]
): Map<string, T> {
  let idx = entryIndexCache.get(key)
  if (!idx) {
    idx = new Map<string, unknown>()
    for (const e of entries) if (!idx.has(e.id)) idx.set(e.id, e)
    entryIndexCache.set(key, idx)
  }
  return idx as Map<string, T>
}
