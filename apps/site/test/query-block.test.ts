import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('page/query-demo')
})

describe('query block', () => {
  it('renders a grid of post cards', () => {
    expect(html).toContain('setu-posts--grid')
  })
  it('honors the author-set column count via a literal-class grid', () => {
    // query-demo uses columns=4 → the grid gets a literal cols class + literal repeat() track.
    expect(html).toContain('setu-posts--cols-4')
    // whitespace-insensitive: the production build minifies the CSS.
    expect(html).toMatch(/repeat\(\s*4\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/)
  })
  it('uses only literal repeat() counts (Safari/Firefox drop repeat(var(…)) / repeat(min(…)))', () => {
    // Regression guard: var()/min() as a grid track count is invalid in Safari/Firefox, which
    // silently collapses the grid to a single column (renders as a list). Never reintroduce it.
    expect(html).not.toMatch(/repeat\(\s*(?:var|min)\(/)
  })
  it('lists same-default-locale (en) posts and excludes other locales', () => {
    expect(html).toContain('href="/post/kitchen-sink"')
    expect(html).toContain('href="/post/astro-on-the-edge"')
    expect(html).not.toContain('/post/fr/') // the French Bonjour post is excluded by locale default
  })
  it('renders a thumbnail for a post that has a featured image', () => {
    // featured-demo.mdoc has featuredImage: /media/2026/06/test-cat.jpg
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toMatch(/<img[^>]+src="[^"]*\/media\/2026\/06\/test-cat\.jpg"/)
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
