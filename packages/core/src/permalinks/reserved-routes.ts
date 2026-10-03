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
  '[locale]/category/[slug]/[...page]',
  '[locale]/tag/[slug]/[...page]',
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

type SegPart = { lit: string } | { param: true }
type RouteSeg = { rest: true } | { parts: SegPart[] }

/** One route pattern → its segments, validated. Matching is done by hand rather than by a
 *  regex built from the pattern: a segment with two adjacent params (`[a][b]`) compiles to an
 *  ambiguous `[^/]+[^/]+`, which backtracks polynomially on a long content-derived path. */
function parseRoute(route: string): RouteSeg[] {
  const segs = route.split('/')
  return segs.map((seg, i) => {
    if (
      seg.startsWith('[...') &&
      seg.endsWith(']') &&
      !seg.slice(4, -1).includes(']')
    ) {
      if (i !== segs.length - 1)
        throw new Error(`reserved route "${route}": a rest param must be last`)
      return { rest: true }
    }
    if (seg.includes('[...'))
      throw new Error(`reserved route "${route}": malformed rest param`)
    const parts: SegPart[] = []
    let i0 = 0
    while (i0 < seg.length) {
      const open = seg.indexOf('[', i0)
      const close = seg.indexOf(']', i0)
      if (open === -1) {
        if (close !== -1)
          throw new Error(`reserved route "${route}": unbalanced brackets`)
        parts.push({ lit: seg.slice(i0).toLowerCase() })
        break
      }
      if (close !== -1 && close < open)
        throw new Error(`reserved route "${route}": unbalanced brackets`)
      const end = seg.indexOf(']', open)
      if (
        end === -1 ||
        end === open + 1 ||
        seg.slice(open + 1, end).includes('[')
      )
        throw new Error(`reserved route "${route}": unbalanced brackets`)
      if (open > i0) parts.push({ lit: seg.slice(i0, open).toLowerCase() })
      parts.push({ param: true })
      i0 = end + 1
    }
    return { parts }
  })
}

/** Does one path segment (already lower-cased) match one pattern segment? A param matches one
 *  or more characters; adjacent params collapse to one (they jointly need ≥2 chars). Literals
 *  are found left to right with indexOf, so this is linear in the segment. */
function matchSegment(parts: SegPart[], seg: string): boolean {
  let pos = 0
  let pendingMin = 0 // chars the params since the last literal must consume, at least
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if ('param' in part) {
      pendingMin++
      continue
    }
    const isLast = k === parts.length - 1
    if (pendingMin === 0) {
      if (!seg.startsWith(part.lit, pos)) return false
      pos += part.lit.length
      if (isLast && pos !== seg.length) return false
    } else if (isLast) {
      if (
        !seg.endsWith(part.lit) ||
        seg.length - part.lit.length - pos < pendingMin
      )
        return false
      pos = seg.length
    } else {
      const at = seg.indexOf(part.lit, pos + pendingMin)
      if (at === -1) return false
      pos = at + part.lit.length
    }
    pendingMin = 0
  }
  return pendingMin === 0 ? pos === seg.length : seg.length - pos >= pendingMin
}

function matchRoute(route: RouteSeg[], path: string): boolean {
  const segs = path.toLowerCase().split('/')
  for (let i = 0; i < route.length; i++) {
    const r = route[i]!
    if ('rest' in r) return segs.slice(i).every((s) => s !== '') // zero or more segments
    if (i >= segs.length || segs[i] === '' || !matchSegment(r.parts, segs[i]!))
      return false
  }
  return segs.length === route.length
}

const compiled = new Map<string, RouteSeg[]>()
const parsedFor = (route: string): RouteSeg[] => {
  let r = compiled.get(route)
  if (!r) compiled.set(route, (r = parseRoute(route)))
  return r
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
  for (const route of routes)
    if (matchRoute(parsedFor(route), path)) return route
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
