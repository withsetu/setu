/** A stable per-entry content id: a UUID v4 stored in frontmatter as `cid`, independent of
 *  slug / locale / path. It survives a slug rename (which changes the Astro id
 *  `collection/locale/slug`), so identity-sensitive features — auto-301 redirects (#252),
 *  translation grouping, cross-references — can track an entry across renames. See #389. */

/** Mint a fresh content id. Edge-safe: Web Crypto `randomUUID` is present in browsers,
 *  Cloudflare Workers, and Node ≥19 — no native dep, no filesystem. */
export function newCid(): string {
  return globalThis.crypto.randomUUID()
}

/** True for a canonical UUID string — used to decide whether an entry still needs a cid
 *  (backfill / assign-on-create) without minting a duplicate. */
export function isCid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
}
