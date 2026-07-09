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
    expect(html).not.toContain('/fr/post/') // the French Bonjour post is excluded by locale default
  })
  it('renders a thumbnail for a post that has a featured image', () => {
    // featured-demo.mdoc has featuredImage: /media/2026/06/test-cat.jpg
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toMatch(/<img[^>]+src="[^"]*\/media\/2026\/06\/test-cat\.jpg"/)
  })
  it('excludes posts marked published:false (#128)', () => {
    // unpublished-demo.mdoc has published:false — it must never reach the block.
    expect(html).not.toContain('/post/unpublished-demo')
    expect(html).not.toContain('Unpublished Demo')
  })
  it('shows a formatted date on cards that have one (#129)', () => {
    // astro-on-the-edge.mdoc has date: 2026-06-20 → a <time> with a locale-formatted label.
    expect(html).toMatch(
      /<time class="setu-post-card__date"[^>]*datetime="2026-06-20"/
    )
    expect(html).toMatch(/Jun\s+20,\s+2026/)
  })
  it('shows a body-derived excerpt on cards (#129)', () => {
    expect(html).toContain('setu-post-card__excerpt')
    // astro-on-the-edge body → plain-text snippet, markdoc/markdown stripped.
    expect(html).toContain(
      'A short companion post about running Astro content at the edge.'
    )
  })
  it('renders an empty state, not a bare empty list, when no posts match (#421)', () => {
    // query-demo has a second block filtered to a nonexistent category → zero matches.
    expect(html).toContain('setu-posts__empty')
    expect(html).toContain('No posts found.')
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(
      /<script(?![^>]*type="application\/ld\+json")[\s>]/
    )
  })

  // #424 regression guard. The shared `.setu-post-card__*` card CSS was deduped into
  // theme-default/site.css (a global import), removing three inline copies. The exact failure this
  // catches: the card class renders in the page markup while NO served CSS actually DEFINES the
  // rule — which is what happens if the shared CSS is wired via a folder-block frontmatter import
  // (Astro's markdoc pipeline collects a component's scoped <style> but not that import side-effect,
  // so the rule silently never loads). Asserting the class is in the HTML is NOT enough. We follow
  // the page's own <style>/<link> to the CSS the browser actually receives and require a rule BODY.
  it('serves a real .setu-post-card__title rule body on the page, not just the class in markup (#424)', () => {
    const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .join('\n')
    const linkedCss = [...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)]
      .map((m) => readFileSync(join(appDir, 'dist', m[1]), 'utf8'))
      .join('\n')
    const servedCss = `${inlineCss}\n${linkedCss}`
    // The class MUST also render in the markup (sanity: the guard would be vacuous otherwise).
    expect(html).toContain('class="setu-post-card__title"')
    // …and the served CSS must DEFINE it, SCOPED under `.setu-posts`. The `.setu-posts ` prefix is
    // load-bearing, NOT cosmetic: the block renders inside `.prose measure-*`, and the theme's
    // `.prose a` (specificity 0,1,1) would out-specify a bare `.setu-post-card__title` (0,1,0) →
    // titles fall back to underlined accent links (caught in live UAT). The two-class selector
    // (0,2,0) wins. Match the scoped form so a regression to the losing selector fails here.
    // The build minifies but keeps the descendant combinator; allow flexible whitespace.
    expect(servedCss).toMatch(
      /\.setu-posts\s+\.setu-post-card__title\s*\{[^}]+\}/
    )
    // The deduped rule reads the contract token, not a hardcoded brand color (#424 also fixed the
    // archive copy's non-contract vars). Prove the token, not a hex literal, reaches the page.
    expect(servedCss).toMatch(
      /\.setu-posts\s+\.setu-post-card__title\s*\{[^}]*var\(--font-ui\)/
    )
  })
})
