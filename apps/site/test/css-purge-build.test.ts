import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// #1119 — render-smoke for the per-page CSS purge (apps/site/integrations/per-page-css-purge.mjs)
// against a REAL `astro build`. The chosen behaviour, pinned here so it cannot drift silently:
//
//   - inline <style> blocks are purged per page (a page carries no unused block's rules there);
//   - a stylesheet linked from 2+ pages stays EXTERNAL, on disk, unpurged and cached — so it
//     still carries every block's rules, which is the deliberate trade documented on
//     `purgeDist`; changing that (the theme-base / per-block split, #1133) must
//     update this suite on purpose;
//   - the build log measures only what was purged and names the shared bytes it skipped —
//     checked against the sizes actually on disk, not against itself.
//
// OWN-BUILD (url-guard-sinks.test.ts pattern), not the shared-dist existsSync guard: the log
// line is only observable from a build this suite runs, and a dist left by some other build
// (or one built with the integration off) would make the on-disk assertions meaningless.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return htmlFiles(p)
    return name.endsWith('.html') ? [p] : []
  })

const stripStyles = (html: string) =>
  html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
const inlineCss = (html: string) =>
  [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1] ?? '')
    .join('\n')
const linkedSheets = (html: string) =>
  [
    ...html.matchAll(
      /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+\.css)"[^>]*>/g
    )
  ].map((m) => m[1] ?? '')
/** `.blk-<name>` block-root classes a CSS string has rules for. */
const blockClasses = (css: string) =>
  new Set([...css.matchAll(/\.(blk-[a-z]+)(?![\w-])/g)].map((m) => m[1] ?? ''))

let log = ''
const pages = new Map<string, string>()
const refCount = new Map<string, number>()

beforeAll(() => {
  log = execSync('pnpm build', {
    cwd: appDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  for (const file of htmlFiles(distDir)) {
    const html = readFileSync(file, 'utf8')
    pages.set(relative(distDir, file), html)
    for (const href of linkedSheets(html))
      refCount.set(href, (refCount.get(href) ?? 0) + 1)
  }
}, 180_000)

const sheetPath = (href: string) => join(distDir, href.replace(/^\//, ''))
const shared = () => [...refCount].filter(([, n]) => n >= 2).map(([h]) => h)

describe('per-page CSS purge — built output (#1119)', () => {
  it('purges inline <style> per page: no inline rule for a block the page does not render', () => {
    // Non-vacuity: before the purge, embed-demo's inline CSS carries hero/section/video rules
    // (Astro inlines those small block stylesheets into every page that pulls the shared
    // Markdoc config). The embed's own rules must survive; the others must not.
    const embedDemo = pages.get('page/embed-demo/index.html') ?? ''
    expect(blockClasses(inlineCss(embedDemo))).toContain('blk-embed')

    for (const [route, html] of pages) {
      const markup = stripStyles(html)
      for (const cls of blockClasses(inlineCss(html)))
        expect(markup, `${route}: inline CSS keeps unused .${cls}`).toMatch(
          new RegExp(`\\b${cls}\\b`)
        )
    }
  })

  it('leaves every shared stylesheet external, on disk and linked — and unpurged by design', () => {
    const sheets = shared()
    expect(sheets.length).toBeGreaterThan(0)
    for (const href of sheets) expect(existsSync(sheetPath(href))).toBe(true)

    // The deliberate trade, pinned: /page/about/ renders no hero, yet the cached shared
    // bundle it links still carries .blk-hero. If this starts failing, the purge strategy
    // changed — update the docblock on `purgeDist` and this suite together.
    const about = pages.get('page/about/index.html') ?? ''
    expect(stripStyles(about)).not.toMatch(/\bblk-hero\b/)
    const aboutShared = linkedSheets(about).filter((h) => sheets.includes(h))
    expect(aboutShared.length).toBeGreaterThan(0)
    expect(
      aboutShared.some((h) =>
        blockClasses(readFileSync(sheetPath(h), 'utf8')).has('blk-hero')
      )
    ).toBe(true)
  })

  it('leaves no dangling stylesheet link (an inlined sheet is unlinked before it is deleted)', () => {
    for (const href of refCount.keys())
      expect(existsSync(sheetPath(href)), href).toBe(true)
  })

  it('logs a saving only for purged CSS and names the shared bytes it skipped, matching disk', () => {
    const line = log
      .split('\n')
      .find((l) => l.includes('per-page CSS purge across'))
    expect(line, 'purge log line').toBeDefined()
    const sheets = shared()
    const sharedBytes = sheets.reduce(
      (sum, h) => sum + statSync(sheetPath(h)).size,
      0
    )
    const kb = `${(sharedBytes / 1024).toFixed(1)} kB`
    const noun = sheets.length === 1 ? 'stylesheet' : 'stylesheets'
    expect(line).toContain(
      `${sheets.length} shared ${noun} (${kb}) left external + cached, NOT purged`
    )
    expect(line).toContain(`across ${pages.size} pages`)
    // The pre-#1119 wording claimed the percentage for the whole page set.
    expect(line).not.toContain('inlined across')
  })
})
