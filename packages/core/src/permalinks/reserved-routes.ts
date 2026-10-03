/**
 * URL paths the site serves itself, which no entry's permalink may take (#1122).
 *
 * The permalink map only disambiguates entries against EACH OTHER. An entry resolving to
 * one of these paths writes the same `dist/` file as the site's own route — Astro has no
 * duplicate-output detection, so the last writer silently wins in a build, while `astro dev`
 * ranks a static segment above the `[...path]` catch-all and always serves the route. One of
 * the two disappears with no warning, and dev and prod can disagree about which.
 *
 * Patterns use Astro's route syntax, relative to the site root: `[name]` matches exactly one
 * path segment (or part of one: `post-sitemap-[page].xml`), `[...name]` matches zero or more
 * trailing segments. Every route under `apps/site/src/pages` (bar the `[...path]` catch-all and
 * the root index), every route `astro.config.mjs` injects, and every file in
 * `apps/site/public` must be listed here; apps/site/test/reserved-routes-source.test.ts walks
 * those sources and fails on any that is missing. Pure: edge-safe.
 */
export const SITE_RESERVED_ROUTES: readonly string[] = [
  // apps/site/src/pages
  'posts/[...page]',
  'category/[slug]/[...page]',
  'tag/[slug]/[...page]',
  'rss.xml',
  '[locale]/rss.xml',
  'robots.txt',
  'sitemap.xml',
  'post-sitemap-[page].xml',
  'page-sitemap.xml',
  'category-sitemap.xml',
  'tag-sitemap.xml',
  // injected by astro.config.mjs (dev only, but the path is still the site's)
  'preview',
  // apps/site/public (sitemap.xsl tracked; _redirects written by scripts/gen-redirects.mjs)
  'sitemap.xsl',
  '_redirects',
  // written into dist by the build itself: Astro's hashed assets and the security-headers
  // integration's `_headers`
  '_astro/[...asset]',
  '_headers'
]

export interface ReservedRouteCollision {
  /** Entry id (`collection/locale/slug`). */
  id: string
  /** The entry's resolved permalink (no leading slash). */
  path: string
  /** The reserved route pattern it collides with. */
  route: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One route pattern → an anchored, case-insensitive regex over a slash-free path. */
function routeRegex(route: string): RegExp {
  const segs = route.split('/')
  let re = ''
  segs.forEach((seg, i) => {
    const rest = /^\[\.\.\.[^\]]+\]$/.exec(seg)
    if (rest) {
      if (i !== segs.length - 1)
        throw new Error(`reserved route "${route}": a rest param must be last`)
      // Zero or more trailing segments: `posts` itself, `posts/2`, `posts/a/b`.
      re += i === 0 ? '(?:[^/]+(?:/[^/]+)*)?' : '(?:/[^/]+)*'
      return
    }
    if (seg.includes('[...'))
      throw new Error(`reserved route "${route}": malformed rest param`)
    const body = seg
      .split(/(\[[^\]]+\])/)
      .map((part) => {
        if (/^\[[^\]]+\]$/.test(part)) return '[^/]+'
        if (/[[\]]/.test(part))
          throw new Error(`reserved route "${route}": unbalanced brackets`)
        return escapeRe(part)
      })
      .join('')
    re += (i === 0 ? '' : '/') + body
  })
  return new RegExp(`^${re}$`, 'i')
}

const compiled = new Map<string, RegExp>()
const regexFor = (route: string): RegExp => {
  let re = compiled.get(route)
  if (!re) compiled.set(route, (re = routeRegex(route)))
  return re
}

/** The reserved route a permalink (no leading slash) collides with, or null. Case-insensitive,
 *  because a build on a case-insensitive filesystem (macOS, Windows) merges `Posts/` and
 *  `posts/` into one output. The site root (`''`) is never reserved here — index.astro and the
 *  root overrides own it. */
export function matchReservedRoute(
  path: string,
  routes: readonly string[] = SITE_RESERVED_ROUTES
): string | null {
  if (path === '') return null
  for (const route of routes) if (regexFor(route).test(path)) return route
  return null
}

/** Every entry whose permalink collides with a reserved route. `include` narrows to the ids
 *  that actually get a route (the site passes "is published"). */
export function findReservedRouteCollisions(
  paths: Iterable<[string, string]>,
  include: (id: string) => boolean = () => true,
  routes: readonly string[] = SITE_RESERVED_ROUTES
): ReservedRouteCollision[] {
  const out: ReservedRouteCollision[] = []
  for (const [id, path] of paths) {
    if (!include(id)) continue
    const route = matchReservedRoute(path, routes)
    if (route) out.push({ id, path, route })
  }
  return out
}

/** A human-facing report naming each entry, its permalink, and the route it collides with. */
export function formatReservedRouteCollisions(
  collisions: ReservedRouteCollision[]
): string {
  const lines = collisions.map(
    (c) =>
      `  - entry "${c.id}" resolves to "/${c.path}", which is the site's own route "/${c.route}"`
  )
  return [
    `${collisions.length} permalink${collisions.length === 1 ? '' : 's'} collide${collisions.length === 1 ? 's' : ''} with a site route:`,
    ...lines,
    "Change the entry's slug or its collection's permalink pattern (Settings → Permalinks)."
  ].join('\n')
}

/** Top-level path segments the site owns as a whole namespace: the literal first segment of
 *  every multi-segment route (`posts`, `category`, `tag`, `_astro`). A collection with one of
 *  these names would, under the default `:collection/:slug` pattern, put every entry inside a
 *  site route — so they are also reserved collection names (`RESERVED_COLLECTION_NAMES`). */
export function reservedRouteNamespaces(
  routes: readonly string[] = SITE_RESERVED_ROUTES
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const route of routes) {
    const [first, ...rest] = route.split('/')
    if (rest.length > 0 && first && !first.includes('[')) out.add(first)
  }
  return out
}
