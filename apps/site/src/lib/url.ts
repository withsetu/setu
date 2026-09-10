import { DEFAULT_LOCALE } from '@setu/core'
import { permalinkMap } from './permalinks'

// DEFAULT_LOCALE and the locale-dropping rule now live in @setu/core (entryUrlPath),
// so the site and the admin's "View Page" link share one source of truth and can't drift.
export { DEFAULT_LOCALE }

/** URL path for a content id via the site-wide collision-aware map. */
export async function urlPathOf(id: string): Promise<string> {
  const map = await permalinkMap()
  const path = map.get(id)
  if (path === undefined)
    throw new Error(`[setu] permalinks: unknown entry id "${id}"`)
  return path
}

/**
 * Resolve a raw media value (a `featuredImage`, an OG image, a gallery src) to an absolute URL.
 *
 * ONE resolver, because there used to be three (#1113). `seo.ts`'s `absMedia`, `sitemap.ts`'s
 * inline `resolve` inside `entryImages`, and `rss-xml.ts`'s `mediaItemUrl` each implemented this
 * separately, and #861 fixed the protocol-relative case in exactly one of them — so the same
 * `featuredImage: //cdn.example/hero.jpg` produced a correct `og:image`, a sitemap `<image:loc>`
 * pointing at a 404 on our own origin, and an RSS `<media:content url>` on the wrong host.
 *
 * The three rules, in order:
 *   1. Already absolute (`https://…` or a protocol-relative `//host/…`) → never touch it. A
 *      protocol-relative URL resolves against the page's scheme and is NOT ours to prefix; giving
 *      it the media base is what corrupted the share image in #861 SEO-4.
 *   2. Root-relative (`/media/…`, `/anything`) → prepend the media base, then absolutize.
 *   3. Anything else → resolve relative to the site origin.
 *
 * Enforced by apps/site/test/media-url.test.ts, which drives every input shape through this
 * function AND asserts all three call sites agree on each one — so a future fix cannot land in one
 * copy again.
 */
export function absoluteMediaUrl(
  raw: string | undefined,
  mediaBase: string,
  siteUrl: string | URL
): string | undefined {
  if (!raw) return undefined
  const isAbsolute = /^https?:\/\//i.test(raw) || raw.startsWith('//')
  const viaMedia =
    !isAbsolute && raw.startsWith('/') ? `${mediaBase}${raw}` : raw
  return new URL(viaMedia, siteUrl).href
}
