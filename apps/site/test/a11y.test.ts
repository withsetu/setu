// Output-site axe-core structural a11y lane (issue #220, the OTHER half of T1's admin e2e
// lane). Scans the site's BUILT static HTML — semantic HTML, heading structure, ARIA,
// enforced alt-text — per PRD §25(b).
//
// LIMITATION (documented per the brief, don't skip this): this lane runs axe-core against
// each built page's HTML parsed by jsdom, with NO real rendering/layout engine. axe-core's
// own docs (README: "There is limited support for JSDOM... the `color-contrast` rule is
// known not to work with JSDOM") and general practice say any rule that depends on computed
// layout, visibility, or rendered color (color-contrast, and rules that need real CSS
// cascade/paint) cannot be trusted here — see DISABLED_RULES below for the explicit,
// reasoned list. This lane only asserts structural/ARIA/alt-text rules that are pure-DOM.
// Rendered/visual checks (contrast, focus-visible, etc.) are the admin e2e lane's job
// (e2e/specs/a11y.spec.ts, real Chromium) — a future increment could add a Playwright pass
// over built pages for that; not this task.
//
// TOPOLOGY: axe-core + jsdom are devDependencies of a test file only — they never ship in
// the site build or run at request time in any topology (local/VPS/edge). Zero runtime or
// production impact, so no topology-impact concerns per CLAUDE.md.
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import axeCore from 'axe-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { classifyViolations, formatKnownViolations, formatUnexpectedViolations } from './lib/a11y-allowlist'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// Rules disabled because they need real layout/paint/rendering that jsdom does not provide
// (jsdom has no layout engine — no computed styles from an actual box model, no painted
// colors). Running them under jsdom produces false negatives/positives, not signal — axe's
// own README calls this out by name for color-contrast; the rest follow the same "needs
// real rendering" reasoning and are disabled for the same cause.
const DISABLED_RULES = {
  'color-contrast': 'needs real rendered color — axe-core README documents this as unsupported under JSDOM',
  'meta-viewport': 'needs real viewport/zoom rendering to evaluate user-scalable behavior',
}

/** Recursively collect every built HTML document under dist/, skipping non-HTML assets
 *  (fonts, JS, CSS in _astro/, etc.) — walks whatever the build actually produced instead
 *  of a hardcoded page list, so new content/routes are swept automatically. */
function walkHtmlFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkHtmlFiles(full))
    else if (entry.endsWith('.html')) out.push(full)
  }
  return out
}

/** Run an axe scan against one built page's HTML via jsdom, classify violations against
 *  the local allowlist, log the known ones (product-gap visibility even when they don't
 *  fail), and return the unexpected ones for the caller to assert on. */
async function scanPage(filePath: string, pageLabel: string) {
  const html = readFileSync(filePath, 'utf8')
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  try {
    const results = await axeCore.run(dom.window.document.documentElement, {
      runOnly: { type: 'tag', values: TAGS },
      rules: Object.fromEntries(Object.keys(DISABLED_RULES).map((id) => [id, { enabled: false }])),
    })
    const { known, unexpected } = classifyViolations(results)
    console.log(formatKnownViolations(pageLabel, known))
    return { unexpected }
  } finally {
    dom.window.close()
  }
}

let pages: { filePath: string; route: string }[] = []

beforeAll(() => {
  // Plain default build — same seam every other apps/site suite reuses (see
  // theme-options.test.ts / related.test.ts / query-block.test.ts): `pnpm build` runs a
  // real `astro build` into the shared dist/, which vitest.config.ts serializes
  // (fileParallelism: false) so builds across test files never race.
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  pages = walkHtmlFiles(distDir).map((filePath) => ({ filePath, route: filePath.slice(distDir.length) }))
}, 180_000)

describe('output-site a11y (axe, structural WCAG 2.1 AA)', () => {
  it('built at least one page to scan', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it('every built page has zero unexpected (non-allowlisted) axe violations', async () => {
    expect(pages.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const { filePath, route } of pages) {
      const { unexpected } = await scanPage(filePath, route)
      if (unexpected.length > 0) failures.push(formatUnexpectedViolations(route, unexpected))
    }
    expect(failures, `${failures.length} page(s) with unexpected axe violations:\n\n${failures.join('\n\n')}`).toEqual([])
  })
})
