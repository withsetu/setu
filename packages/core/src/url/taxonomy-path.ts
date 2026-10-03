import { DEFAULT_LOCALE } from './locale'
import type { PostRow } from '../posts/select-posts'

/** The served path of a category/tag archive, as the ONE spelling every surface advertises: the
 *  theme's taxonomy chip href, the archive route's pagination base, the sitemap `<loc>`, the
 *  hreflang alternates, and (because the canonical is `new URL(Astro.url.pathname, site)`) the
 *  archive page's self-canonical (#1120).
 *
 *  The default locale is unprefixed (`/tag/astro/`); every other locale gets its own archive under
 *  `/<locale>/` (`/fr/tag/voyage/`), matching per-locale RSS (#1114).
 *
 *  Two steps, in order:
 *  1. Astro's static-route generator transform on the param (`astro/dist/core/routing/generator.js`
 *     `sanitizeParams`): Unicode-normalize, then `#`→`%23` and `?`→`%3F`. That is the route path
 *     Astro builds, and without it a `c#4` tag truncates at the fragment.
 *  2. WHATWG URL path serialization of that route path — what the canonical goes through — which
 *     percent-encodes a space (`web dev` → `web%20dev`), `"`, `<`, `>`, and non-ASCII (UTF-8).
 *     Tags are never slugified, so a raw space reaching a `<loc>` is an invalid sitemap URL.
 *
 *  Lives in core so the theme (which cannot import from apps/site) and the site share it.
 *  Enforced by packages/core/test/url/taxonomy-path.test.ts (the encoding + locale prefix) and
 *  apps/site/test/taxonomy-archive.test.ts (every built chip href resolves to an emitted archive;
 *  chip href == sitemap loc). */
export function taxonomyArchivePath(
  kind: 'category' | 'tag',
  slug: string,
  locale: string = DEFAULT_LOCALE
): string {
  const routeSegment = slug
    .normalize()
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`
  return new URL(`${prefix}/${kind}/${routeSegment}/`, 'http://setu.invalid')
    .pathname
}

/** term → the locales that have at least one published post carrying it (default locale first,
 *  then alphabetical). This is exactly the set of per-locale archives the site emits for a term,
 *  so it drives both the archive routes' hreflang alternates and the sitemap (#1114). Same
 *  published-ness rule as selectPosts: only an explicit `published: false` hides a post.
 *  Enforced by packages/core/test/url/taxonomy-path.test.ts. */
export function taxonomyTermLocales(
  rows: readonly PostRow[],
  pick: (r: PostRow) => string[]
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.collection !== 'post' || r.published === false) continue
    for (const term of pick(r)) {
      if (!term) continue
      let s = sets.get(term)
      if (!s) sets.set(term, (s = new Set()))
      s.add(r.locale)
    }
  }
  const order = (a: string, b: string): number =>
    a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b)
  return new Map([...sets].map(([term, s]) => [term, [...s].sort(order)]))
}
