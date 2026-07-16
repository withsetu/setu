/** Content-pack contract (#511, epic #509).
 *
 *  A content pack turns an open, licensing-verified dataset into a normalized stream
 *  of seed material the demo-data seed engine (#512) writes into a dev site. The
 *  contract is deliberately small: packs own "where the data comes from and what it
 *  means"; the engine owns "how it becomes users/posts/media in Setu".
 *
 *  Streaming shape: `PackDataset.posts` is an `AsyncIterable`, not an array. The AIC
 *  dump alone is 134k records / ~1 GB of JSON on disk (verified 2026-07-16); a pack
 *  must be consumable one post at a time without ever materializing the whole
 *  dataset in memory. The engine writes posts sequentially anyway, so a pull-based
 *  stream is the natural seam — and an array-shaped pack can still trivially wrap
 *  itself in one.
 */

export interface PackMeta {
  /** Stable slug identifying the pack (e.g. "aic"). */
  id: string
  /** Human-readable source name (e.g. "Art Institute of Chicago"). */
  name: string
  /** Citation URL for the dataset / its documentation. */
  sourceUrl: string
  /** One-line license summary, including per-field exceptions. Every pack MUST
   *  state its licensing; the repo ships no third-party content — packs fetch at
   *  seed time. */
  license: string
}

/** A reference to a source-hosted image, sized on demand.
 *
 *  Packs never download image bytes (that is the #512 engine's job); they expose a
 *  capability to build a URL for an arbitrary pixel width so the engine can pick a
 *  big/small/medium mix by construction (AIC: IIIF `/full/{w},/0/default.jpg`).
 */
export interface PackImageRef {
  /** License statement covering the image bytes themselves. */
  license: string
  /** Intrinsic full-resolution width in px, when the source publishes it. */
  maxWidth?: number
  /** Intrinsic full-resolution height in px, when the source publishes it. */
  maxHeight?: number
  /** Alt text from the source, when available. */
  alt?: string
  /** Build a URL serving this image at the given pixel width (aspect preserved). */
  urlForWidth(width: number): string
}

/** One normalized post-shaped record. All content comes from real source fields —
 *  packs never fabricate prose. */
export interface PackPost {
  /** Pack-unique, stable id (e.g. the AIC artwork id). Stability across runs is what
   *  makes seeding deterministic and resumable. */
  id: string
  title: string
  /** Markdown body composed from real source fields, including any per-field
   *  attribution lines the source license requires. */
  body: string
  /** Plain-text summary suitable for list views / meta descriptions. */
  excerpt: string
  /** ISO 8601 date. Packs derive it from real source data (creation year, source
   *  timestamps); the seed engine may redistribute dates for realism. */
  date: string
  /** Attribution string for the underlying work (e.g. the artist display line). */
  sourceAttribution: string
  /** Terms grouped by taxonomy slug, e.g. `{ categories: [...], tags: [...] }`.
   *  Arrays are ordered and deduplicated. */
  terms: Record<string, readonly string[]>
  image?: PackImageRef
}

export interface PackLoadOptions {
  /** Yield at most this many posts (bounded previews / smokes). */
  limit?: number
  /** Abort a long-running load; iteration throws the signal's reason. */
  signal?: AbortSignal
}

export interface PackStats {
  /** Source records inspected. Always `loaded` + sum of `skipped` counts. */
  scanned: number
  /** Posts yielded. */
  loaded: number
  /** Records dropped, keyed by pack-documented reason (e.g. `invalid`,
   *  `notPublicDomain`, `noImage`). Bad records are skipped and counted — a pack
   *  never crashes on one malformed record. */
  skipped: Readonly<Record<string, number>>
}

export interface PackDataset {
  /** Single-pass stream of normalized posts. Deterministic: the same source input
   *  yields the same posts in the same order. */
  posts: AsyncIterable<PackPost>
  /** Running counters; final once `posts` has been fully consumed. */
  stats(): PackStats
}

export interface ContentPack {
  meta: PackMeta
  /** Open the pack's (already-fetched, local) source and stream normalized posts.
   *  Each call returns a fresh, independent dataset. */
  load(options?: PackLoadOptions): PackDataset
}

/** Convenience: drain a dataset into memory (tests, small previews — NOT the seed
 *  path; 30k-record datasets should be consumed via the stream). */
export async function collectPosts(dataset: PackDataset): Promise<PackPost[]> {
  const out: PackPost[] = []
  for await (const post of dataset.posts) out.push(post)
  return out
}
