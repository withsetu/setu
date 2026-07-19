import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the columns block (#181):
// content/page/en/columns-demo.mdoc renders @setu/blocks Columns.astro/Column.astro —
// a 33-67 split with a nested callout + list, and a 3-up band — through the real
// markdoc + theme pipeline. Reuses an existing dist/ like contact-block.test.ts —
// none of these assertions depend on build-time env.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string) =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  if (!existsSync(join(appDir, 'dist', 'page', 'columns-demo', 'index.html'))) {
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  }
  html = page('page/columns-demo')
}, 180_000)

describe('columns block render (#181)', () => {
  it('renders the grid container with layout-derived classes and template', () => {
    // 33-67 split, gap lg, stacking on by default.
    expect(html).toMatch(
      /<div class="blk-columns gap-lg stack" style="--blk-columns-template: 33fr 67fr;?">/
    )
    // 3-up band with md gap.
    expect(html).toMatch(
      /<div class="blk-columns gap-md stack" style="--blk-columns-template: 33fr 33fr 33fr;?">/
    )
  })

  it('renders each column slot with its content', () => {
    expect((html.match(/class="blk-column"/g) ?? []).length).toBe(5)
    expect(html).toContain('First of three.')
    expect(html).toContain('Second of three.')
    expect(html).toContain('Third of three.')
  })

  it('nests other blocks inside a column (callout, list)', () => {
    // The callout renders INSIDE a column slot.
    const sidebar = html.slice(
      html.indexOf('class="blk-column"'),
      html.indexOf('Main')
    )
    expect(sidebar).toContain('blk-callout')
    expect(sidebar).toContain('Callouts nest inside columns.')
    expect(html).toContain('<li>alpha</li>')
  })

  it('ships the responsive stacking rule in the page CSS', () => {
    // Astro inlines small stylesheets into <style>; the purge keeps used classes.
    // The grid rule and the mobile stack breakpoint must survive to the page.
    const linked = [...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)]
      .map((m) => readFileSync(join(appDir, 'dist', m[1]), 'utf8'))
      .join('\n')
    const css = (html + linked).replace(/\s+/g, '')
    expect(css).toContain('.blk-columns{')
    expect(css).toContain('.blk-columns.stack{grid-template-columns:1fr}')
    expect(css).toContain('.blk-column{min-width:0}')
  })
})
