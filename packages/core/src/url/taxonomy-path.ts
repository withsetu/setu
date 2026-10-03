/** The served path of a category/tag archive, as the ONE spelling every surface advertises: the
 *  theme's taxonomy chip href, the sitemap `<loc>`, and (because the canonical is
 *  `new URL(Astro.url.pathname, site)`) the archive page's self-canonical (#1120).
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
 *  Enforced by packages/core/test/url/taxonomy-path.test.ts (the encoding) and
 *  apps/site/test/sitemap-fixture-build.test.ts (built chip href == sitemap loc == canonical for
 *  a spaced tag). */
export function taxonomyArchivePath(
  kind: 'category' | 'tag',
  slug: string
): string {
  const routeSegment = slug
    .normalize()
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
  return new URL(`/${kind}/${routeSegment}/`, 'http://setu.invalid').pathname
}
