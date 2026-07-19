export interface Redirect {
  /** Old URL path (root-relative, e.g. `/blog/old-slug`). */
  from: string
  /** Current URL path the old one 301s to. */
  to: string
}

type PathMap = Map<string, string> | Record<string, string>

const get = (map: PathMap, key: string): string | undefined =>
  map instanceof Map ? map.get(key) : map[key]

const keys = (map: PathMap): string[] =>
  map instanceof Map ? [...map.keys()] : Object.keys(map)

const values = (map: PathMap): string[] =>
  map instanceof Map ? [...map.values()] : Object.values(map)

/**
 * Update the redirect table from a URL-map change. For every content id present in BOTH the
 * previous and current map whose path changed, records a `oldPath → newPath` 301. Existing
 * redirects and freshly-added ones are then **collapsed to their terminal target** so a rename
 * chain (A→B, B→C) is served as a single hop (A→C) — search engines and browsers cap redirect
 * chains, and 301 chains bleed link equity.
 *
 * Added ids (no previous path) and removed ids (deleted content, no target) are ignored — there
 * is no meaningful 301 for either. Self-redirects and cycles are dropped. Output is deduped by
 * `from` (one hop per old URL) and sorted for deterministic, diff-friendly serialization.
 *
 * Pure and edge-safe: plain map/array math, no IO. The build layer reads/writes the JSON files.
 */
export function diffRedirects(
  prev: PathMap,
  next: PathMap,
  existing: Redirect[]
): Redirect[] {
  // One hop per `from`; later writes (fresh moves) win over stale existing entries.
  const hop = new Map<string, string>()
  for (const r of existing) hop.set(r.from, r.to)
  for (const id of keys(next)) {
    const before = get(prev, id)
    const after = get(next, id)
    if (before === undefined || after === undefined || before === after)
      continue
    hop.set(before, after)
  }

  // Defence in depth (#657): never emit a redirect whose `from` is a path something
  // currently LIVES at. Cloudflare Pages evaluates `_redirects` ahead of static assets,
  // so such a rule makes a real page unreachable — a 301 away from a page that exists.
  // The guard is here as well as in the resolver because the resolver only knows about
  // ids it was handed, while a stale snapshot can propose any `from` at all.
  const live = new Set(values(next))

  // Follow each hop to its terminal target (guarding against cycles), then drop no-ops.
  const out: Redirect[] = []
  for (const [from] of hop) {
    if (live.has(from)) continue
    const to = terminal(from, hop, live)
    if (to !== null && to !== from) out.push({ from, to })
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** Walk `from` through the hop chain to the final destination. Returns null if a cycle is hit.
 *  The walk STOPS at any path that is currently live: a hop chain is a chain of *paths*, not
 *  of ids, so when two ids swap URLs (a: /1→/2 while b: /2→/3) collapsing past /2 would send
 *  a's old URL to b's page. The first live path it reaches is the right destination (#657). */
function terminal(
  from: string,
  hop: Map<string, string>,
  live: Set<string>
): string | null {
  const seen = new Set<string>([from])
  let cur = hop.get(from)!
  while (cur !== undefined && !live.has(cur) && hop.has(cur)) {
    if (seen.has(cur)) return null // cycle → drop this redirect
    seen.add(cur)
    cur = hop.get(cur)!
  }
  return cur ?? null
}
