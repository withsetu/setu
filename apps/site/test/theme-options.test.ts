import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { optionsToCss } from '@setu/core'
import { themeOptions as themeOptionDeclaration } from '@setu/theme-default/options'
import { loadThemeOptions } from '../src/lib/site-config'

// No theme-options.json at this repo's root → loadThemeOptions() is {} (the defaults),
// matching what `astro build` reads in beforeAll.
const themeOptions = loadThemeOptions()

const appDir = fileURLToPath(new URL('..', import.meta.url))
const themeDir = fileURLToPath(
  new URL('../../../packages/theme-default/', import.meta.url)
)
const distDir = join(appDir, 'dist')
let html = ''
/** Concatenated text of every bundled CSS the page links — the theme CSS we must beat. */
let linkedCss = ''

beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = readFileSync(
    join(distDir, 'post', 'kitchen-sink', 'index.html'),
    'utf8'
  )
  linkedCss = [
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)
  ]
    .map((m) => readFileSync(join(distDir, m[1].replace(/^\//, '')), 'utf8'))
    .join('\n')
})

// #1294: Setu applies the override, not the theme. theme-default deliberately does NOT call
// optionsToCss any more, which makes it the "theme that does nothing" these build assertions are
// about — the guard below keeps that true, or the build checks would prove nothing.
describe('the theme takes no part in applying its options', () => {
  it('theme-default never calls optionsToCss itself', () => {
    for (const f of readdirSync(themeDir).filter((f) => f.endsWith('.astro')))
      expect(readFileSync(join(themeDir, f), 'utf8'), f).not.toContain(
        'optionsToCss'
      )
  })
})

describe('theme options — build wiring', () => {
  it('injects the optionsToCss override into the page head', () => {
    expect(html).toContain(
      `<style>${optionsToCss(themeOptionDeclaration, themeOptions)}</style></head>`
    )
  })
  it('the override carries the theme default tokens (default config)', () => {
    expect(html).toContain('--measure-page: 64rem;')
    expect(html).toContain('--accent: #4f46e5;')
  })
  it('reaches every built page, whatever renders it (posts, pages, archives, taxonomy, home)', () => {
    const pages = htmlFiles(distDir)
    expect(pages.length).toBeGreaterThan(10)
    const css = optionsToCss(themeOptionDeclaration, themeOptions)
    for (const page of pages)
      expect(
        readFileSync(page, 'utf8').split(css).length - 1,
        relative(distDir, page)
      ).toBe(1)
  })
  it('the theme CSS loads first, and the override also wins on specificity (:root:root)', () => {
    // The override is the last thing in <head>, after every bundled stylesheet…
    const overrideIdx = html.indexOf(
      optionsToCss(themeOptionDeclaration, themeOptions)
    )
    const links = [...html.matchAll(/<link[^>]+rel="stylesheet"/g)]
    expect(overrideIdx).toBeGreaterThan(-1)
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) expect(l.index).toBeLessThan(overrideIdx)

    // …and it does not depend on that order: our override is :root:root (0,0,2,0)…
    expect(optionsToCss(themeOptionDeclaration, themeOptions)).toContain(
      ':root:root {'
    )
    // …while the theme CSS we must beat declares the same token under a plain
    // :root (0,0,1,0). Higher specificity wins regardless of position.
    expect(linkedCss).toMatch(/:root\{[^}]*--accent:\s*#4f46e5/)
    expect(linkedCss).not.toContain(':root:root')
  })
})

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? htmlFiles(join(dir, e.name))
      : e.name.endsWith('.html')
        ? [join(dir, e.name)]
        : []
  )
}
