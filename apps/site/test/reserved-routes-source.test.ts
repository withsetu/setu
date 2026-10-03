import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SITE_RESERVED_ROUTES, matchReservedRoute } from '@setu/core'

// #1122: SITE_RESERVED_ROUTES (packages/core/src/permalinks/reserved-routes.ts) is a hand list
// of the paths the site serves itself, because core is pure and cannot walk this app. This
// test is what keeps it from drifting: every route source in this app must be listed, so adding
// a page/injected route/public file without reserving it fails here.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const pagesDir = join(appDir, 'src', 'pages')
const publicDir = join(appDir, 'public')

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** `src/pages/posts/[...page].astro` → `posts/[...page]`; `foo/index.astro` → `foo`. */
const routeOf = (file: string): string =>
  relative(pagesDir, file)
    .split(sep)
    .join('/')
    .replace(/\.(astro|ts|js|md|mdx|html)$/, '')
    .replace(/(^|\/)index$/, '')

describe('SITE_RESERVED_ROUTES covers every route this site serves itself', () => {
  const pageRoutes = walk(pagesDir).map(routeOf)

  it('found the pages (guards against a walk that silently sees nothing)', () => {
    expect(pageRoutes).toContain('posts/[...page]')
    expect(pageRoutes).toContain('[...path]')
  })

  it('every src/pages route is reserved verbatim (bar the entry catch-all and the root)', () => {
    const missing = pageRoutes
      .filter((r) => r !== '[...path]' && r !== '')
      .filter((r) => !SITE_RESERVED_ROUTES.includes(r))
    expect(missing).toEqual([])
  })

  it('every route astro.config.mjs injects is reserved', () => {
    const cfg = readFileSync(join(appDir, 'astro.config.mjs'), 'utf8')
    const injected = [...cfg.matchAll(/pattern:\s*['"]\/([^'"]*)['"]/g)].map(
      (m) => m[1]
    )
    expect(injected).toContain('preview')
    expect(injected.filter((r) => !SITE_RESERVED_ROUTES.includes(r))).toEqual(
      []
    )
  })

  it('every file in public/ (copied verbatim into dist) is reserved', () => {
    const files = walk(publicDir).map((f) =>
      relative(publicDir, f).split(sep).join('/')
    )
    expect(files.filter((f) => matchReservedRoute(f) === null)).toEqual([])
  })
})
