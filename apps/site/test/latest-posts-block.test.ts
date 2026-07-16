import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the latest-posts block (#192): the query block's
// zero-config sibling. content/page/en/latest-posts-demo.mdoc exercises the default
// (bare {% latest-posts /%}), the everything-on grid variant, and the filtered-empty
// state through the real markdoc + theme pipeline.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('page/latest-posts-demo')
})

/** The markup of the Nth latest-posts list on the page (empty states excluded). */
function nthList(n: number): string {
  const lists = [
    ...html.matchAll(/<ul class="blk-latest-posts[^"]*"[\s\S]*?<\/ul>/g)
  ].map((m) => m[0])
  expect(lists.length).toBeGreaterThan(n)
  return lists[n]!
}

describe('latest-posts block — zero-config default', () => {
  it('renders the most recent posts as a list with titles and dates', () => {
    const list = nthList(0)
    expect(list).toContain('blk-latest-posts is-list')
    expect(list).toContain('href="/post/kitchen-sink"')
    expect(list).toContain('href="/post/astro-on-the-edge"')
    // astro-on-the-edge.mdoc has date: 2026-06-20 → a <time> with a formatted label.
    expect(list).toMatch(
      /<time class="blk-latest-posts-date"[^>]*datetime="2026-06-20"/
    )
    expect(list).toMatch(/Jun\s+20,\s+2026/)
  })
  it('keeps excerpts and images off by default (WordPress Latest Posts parity)', () => {
    const list = nthList(0)
    expect(list).not.toContain('blk-latest-posts-excerpt')
    expect(list).not.toContain('blk-latest-posts-media')
  })
  it('excludes posts marked published:false', () => {
    expect(html).not.toContain('/post/unpublished-demo')
    expect(html).not.toContain('Unpublished Demo')
  })
})

describe('latest-posts block — grid variant with display toggles on', () => {
  it('renders a literal-count 3-column grid (Safari/Firefox drop repeat(var(…)))', () => {
    const grid = nthList(1)
    expect(grid).toContain('is-grid')
    expect(grid).toContain('cols-3')
    expect(html).toMatch(/repeat\(\s*3\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/)
    expect(html).not.toMatch(/repeat\(\s*(?:var|min)\(/)
  })
  it('honors count=3', () => {
    const grid = nthList(1)
    const items = grid.match(/blk-latest-posts-item/g) ?? []
    expect(items.length).toBeLessThanOrEqual(3)
    expect(items.length).toBeGreaterThan(0)
  })
  it('shows a thumbnail for a post with a featured image (showImage=true)', () => {
    const grid = nthList(1)
    expect(grid).toContain('blk-latest-posts-media')
    expect(grid).toMatch(/<img[^>]+src="[^"]*\/media\/2026\/06\/test-cat\.jpg"/)
  })
  it('shows a body-derived excerpt (showExcerpt=true)', () => {
    const grid = nthList(1)
    expect(grid).toContain('blk-latest-posts-excerpt')
    expect(grid).toContain(
      'A short companion post about running Astro content at the edge.'
    )
  })
})

describe('latest-posts block — empty and structural guarantees', () => {
  it('renders an empty state, not a bare empty list, when no posts match', () => {
    expect(html).toContain('blk-latest-posts-empty')
    expect(html).toContain('No posts yet.')
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script(?![^>]*type="application\/ld\+json")[\s>]/)
  })
  it('serves a real scoped .blk-latest-posts-title rule body reading contract tokens', () => {
    const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .join('\n')
    const linkedCss = [...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)]
      .map((m) => readFileSync(join(appDir, 'dist', m[1]!), 'utf8'))
      .join('\n')
    const servedCss = `${inlineCss}\n${linkedCss}`
    expect(html).toContain('class="blk-latest-posts-title"')
    // Scoped two-class selector (0,2,0) — a bare .blk-latest-posts-title (0,1,0) would LOSE
    // to the theme's `.prose a` (0,1,1) and titles fall back to underlined accent links
    // (same trap the query block hit, #424).
    expect(servedCss).toMatch(
      /\.blk-latest-posts\s+\.blk-latest-posts-title\s*\{[^}]+\}/
    )
    expect(servedCss).toMatch(
      /\.blk-latest-posts\s+\.blk-latest-posts-title\s*\{[^}]*var\(--text\)/
    )
  })
})
