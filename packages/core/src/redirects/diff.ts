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

  // Follow each hop to its terminal target (guarding against cycles), then drop no-ops.
  const out: Redirect[] = []
  for (const [from] of hop) {
    const to = terminal(from, hop)
    if (to !== null && to !== from) out.push({ from, to })
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/** Walk `from` through the hop chain to the final destination. Returns null if a cycle is hit. */
function terminal(from: string, hop: Map<string, string>): string | null {
  const seen = new Set<string>([from])
  let cur = hop.get(from)!
  while (cur !== undefined && hop.has(cur)) {
    if (seen.has(cur)) return null // cycle → drop this redirect
    seen.add(cur)
    cur = hop.get(cur)!
  }
  return cur ?? null
}
