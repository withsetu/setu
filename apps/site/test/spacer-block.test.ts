import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the spacer block (#183): content/page/en/spacer-demo.mdoc
// carries an explicit-height and a bare default-height {% spacer /%} through the real
// markdoc + theme pipeline. Follows embed-block.test.ts's existsSync-guard pattern —
// the spacer needs no media manifest, so any dist containing the demo page is valid.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string) =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  if (!existsSync(join(appDir, 'dist', 'page', 'spacer-demo', 'index.html'))) {
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  }
  html = page('page/spacer-demo')
}, 180_000)

describe('spacer block render (#183)', () => {
  it('renders pure empty space — an aria-hidden div with the requested height', () => {
    expect(html).toMatch(
      /<div class="blk-spacer"[^>]*style="--blk-spacer-h: 80px;?"[^>]*aria-hidden="true">\s*<\/div>/
    )
  })

  it('a bare {% spacer /%} falls back to the 48px default', () => {
    expect(html).toMatch(/style="--blk-spacer-h: 48px;?"/)
  })

  it('paints nothing and ships no JS — no visible content, no island', () => {
    expect(html).not.toContain('astro-island')
    // the editor-only chrome (height label, hatching classes) never reaches the site
    expect(html).not.toContain('blk-spacer-editor')
    expect(html).not.toContain('80 px')
  })

  it('the spacer height rule is present in the page CSS', () => {
    // All CSS the page can carry — inline <style> blocks AND emitted _astro
    // stylesheets (mirrors render.test.ts's themeCss; the per-page CSS purge may
    // put the rule in either place).
    const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((m) => m[1])
      .join('\n')
    const astroDir = join(appDir, 'dist', '_astro')
    const external = existsSync(astroDir)
      ? readdirSync(astroDir)
          .filter((f) => f.endsWith('.css'))
          .map((f) => readFileSync(join(astroDir, f), 'utf8'))
          .join('\n')
      : ''
    expect(`${inline}\n${external}`).toContain('var(--blk-spacer-h')
  })
})
