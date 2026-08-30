import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The wiring guard for #1075.
 *
 * apps/site/test/theme-fonts.test.ts proves the resolver's LOGIC; this proves it is actually
 * connected. The distinction matters here more than usual: the bug being fixed was font loading
 * silently producing nothing, and the whole suite stayed green through it — a build with no fonts
 * still builds, still renders, and still passes every other assertion. So a test that only checks
 * "the build succeeded" would have passed against the original bug, and would pass again if the
 * virtual-module wiring were broken tomorrow.
 */
const appDir = fileURLToPath(new URL('..', import.meta.url))
const astroDir = join(appDir, 'dist', '_astro')

let css = ''
let woff2 = 0

beforeAll(() => {
  if (!existsSync(join(appDir, 'dist', 'index.html')))
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  const files = readdirSync(astroDir)
  css = files
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(astroDir, f), 'utf8'))
    .join('\n')
  woff2 = files.filter((f) => f.endsWith('.woff2')).length
}, 180_000)

describe("the active theme's fonts reach the build", () => {
  it('emits real @font-face rules and font files', () => {
    expect(css).toMatch(/@font-face/)
    expect(woff2).toBeGreaterThan(0)
  })

  it('bundles the SELECTED family, not every family the theme offers', () => {
    // theme-default's default choice is `grotesk`; its other families must not be dragged in.
    expect(css).toMatch(/font-family:\s*Hanken Grotesk/i)
    expect(css).toMatch(/font-family:\s*JetBrains Mono/i)
    expect(css).not.toMatch(/Fraunces/i)
  })
})
