import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// #1296 — the Wide / Full width primitives and the `.setu-post-card__*` internals ship in
// @setu/blocks/base.css, which the theme loads first, instead of being re-implemented in each
// theme's own CSS. block-width-breakout.test.ts proves the built CSS still HAS a breakout rule per
// width-capable block; this suite proves the move held page by page:
//
//   1. every width marker (`.blk-<tag>.w-wide`, `figure.setu-image.align-full`, …) and every
//      post-card part a built page renders is matched by a rule in the CSS THAT PAGE loads
//      (its linked stylesheets plus its inline <style>s) — so the query/related/archive cards
//      and every Wide/Full block are styled wherever they appear, not merely somewhere in dist/;
//   2. inside the shared stylesheet the base rules come BEFORE the theme's own `:root` tokens —
//      the order that lets a theme restyle a card or a breakout by repeating the selector.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')

/** Newest fixture marker the sibling render suites rely on; a dist without it is stale. */
const MARKER = 'Fragment no-query facade 1249'

const files = (dir: string, ext: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p, ext)
    return name.endsWith(ext) ? [p] : []
  })

interface BuiltPage {
  route: string
  html: string
  css: string
  sheets: string[]
}

let pages: BuiltPage[] = []

beforeAll(() => {
  const demo = join(distDir, 'page', 'embed-demo', 'index.html')
  if (!existsSync(demo) || !readFileSync(demo, 'utf8').includes(MARKER))
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })

  pages = files(distDir, '.html').map((f) => {
    const html = readFileSync(f, 'utf8')
    const sheets = [
      ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)
    ].map((m) => readFileSync(join(distDir, m[1] ?? ''), 'utf8'))
    const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
      (m) => m[1] ?? ''
    )
    return {
      route: relative(distDir, f),
      html,
      css: [...sheets, ...inline].join('\n'),
      sheets
    }
  })
}, 180_000)

/** Every selector in a stylesheet (the text before each `{`), comments stripped. */
const selectorsOf = (css: string): string[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].flatMap(
    (m) => (m[1] ?? '').split(',').map((s) => s.trim())
  )

/** The markers this suite tracks, read off the rendered class lists of a page. */
function markersOf(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    const cls = (m[1] ?? '').split(/\s+/)
    const width = cls.find((c) => /^(?:w|align)-(?:wide|full)$/.test(c))
    const block = cls.find((c) => /^(?:blk-[a-z-]+|setu-image)$/.test(c))
    // `blk-hero-media` etc. are parts, not roots — only a root carries the width class.
    if (width && block) out.add(`.${block}.${width}`)
    for (const c of cls) if (c.startsWith('setu-post-card__')) out.add(`.${c}`)
  }
  return [...out]
}

describe('@setu/blocks base layer styles every page that needs it (#1296)', () => {
  it('found width markers and post cards in the built demo content (anti-vacuity)', () => {
    const all = new Set(pages.flatMap((p) => markersOf(p.html)))
    // What the tracked demo content renders today; the hero's breakout is covered rule-wise by
    // block-width-breakout.test.ts because no demo page sets a hero width.
    for (const m of [
      '.blk-gallery.w-wide',
      '.blk-video.w-wide',
      '.blk-section.w-wide',
      '.blk-section.w-full',
      '.blk-embed.align-wide',
      '.blk-embed.align-full',
      '.setu-image.align-wide',
      '.setu-post-card__title',
      '.setu-post-card__date'
    ])
      expect([...all]).toContain(m)
  })

  it('every width marker and card part on a page is matched by a rule that page loads', () => {
    const unstyled: string[] = []
    for (const page of pages) {
      const selectors = selectorsOf(page.css)
      for (const marker of markersOf(page.html)) {
        // A compound selector names the marker when it contains it as a whole class run,
        // e.g. `.prose .blk-hero.w-wide` or `.prose figure.setu-image.align-full img`.
        const re = new RegExp(
          `${marker.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w-])`
        )
        if (!selectors.some((s) => re.test(s)))
          unstyled.push(`${page.route}: ${marker}`)
      }
    }
    expect(unstyled).toEqual([])
  })

  it('the base rules load before the theme’s own tokens, so a theme restyle wins by order', () => {
    const shared = pages
      .flatMap((p) => p.sheets)
      .find((s) => s.includes('.setu-post-card__title'))
    expect(shared, 'no linked stylesheet carries the base layer').toBeDefined()
    const sheet = shared as string
    const base = sheet.indexOf('.setu-posts .setu-post-card__title')
    // theme-default's own token block — the first rule of theme.css after its base import.
    const theme = sheet.indexOf('--font-heading:')
    expect(base).toBeGreaterThan(-1)
    expect(theme).toBeGreaterThan(-1)
    expect(base).toBeLessThan(theme)
  })
})
