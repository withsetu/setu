/** The id the site falls back to at `/` when the configured `reading.homepage` is missing or a
 *  draft (#165) — the seeded default home page. */
export const FALLBACK_HOMEPAGE_ID = 'page/en/home'

interface HomepageCandidate {
  id: string
  data: unknown
}

/** The entry actually rendered at the site root: the configured homepage if it exists and is not
 *  `published: false`, else `page/en/home` under the same rule, else none (the empty shell).
 *
 *  ONE rule for both consumers — `src/pages/index.astro` (what is served at `/`) and the sitemap
 *  (what is advertised at `/`, and which entry to skip as already-listed) — so the sitemap can no
 *  longer list the root for a noindex homepage or hide an ordinary `/page/home/` (#1120).
 *  Enforced by apps/site/test/homepage.test.ts and apps/site/test/sitemap-fixture-build.test.ts. */
export function resolveHomepageEntry<T extends HomepageCandidate>(
  homepageId: string,
  get: (id: string) => T | undefined
): T | undefined {
  for (const id of [homepageId, FALLBACK_HOMEPAGE_ID]) {
    if (!id) continue
    const e = get(id)
    if (e && (e.data as { published?: unknown } | null)?.published !== false)
      return e
  }
  return undefined
}
