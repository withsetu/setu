import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { optionsToCss } from '@setu/theme-default/options'
import { loadThemeOptions } from '../src/lib/site-config'

// No theme-options.json at this repo's root → loadThemeOptions() is {} (the defaults),
// matching what `astro build` reads in beforeAll.
const themeOptions = loadThemeOptions()

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')
let html = ''
/** Concatenated text of every bundled CSS the page links — the theme CSS we must beat. */
let linkedCss = ''

beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = readFileSync(join(distDir, 'post', 'kitchen-sink', 'index.html'), 'utf8')
  linkedCss = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => readFileSync(join(distDir, m[1]!.replace(/^\//, '')), 'utf8'))
    .join('\n')
})

describe('theme options — build wiring', () => {
  it('injects the optionsToCss override into the page head', () => {
    expect(html).toContain(optionsToCss(themeOptions))
  })
  it('the override carries the theme default tokens (default config)', () => {
    expect(html).toContain('--measure-page: 64rem;')
    expect(html).toContain('--accent: #4f46e5;')
  })
  it('the override wins the cascade via higher specificity (:root:root)', () => {
    // The bundled theme CSS ships in a <link rel="stylesheet"> that loads AFTER
    // our inline <style> override in the built <head>. Verify that ordering so
    // the cascade question is real (source order would let the link win):
    const overrideIdx = html.indexOf(optionsToCss(themeOptions))
    const linkIdx = html.search(/<link[^>]+rel="stylesheet"/)
    expect(overrideIdx).toBeGreaterThan(-1)
    expect(linkIdx).toBeGreaterThan(overrideIdx) // theme CSS comes AFTER → order can't save us

    // So we win on SPECIFICITY: our override is :root:root (0,0,2,0)…
    expect(optionsToCss(themeOptions)).toContain(':root:root {')
    expect(html).toContain(':root:root {')
    // …while the theme CSS we must beat declares the same token under a plain
    // :root (0,0,1,0). Higher specificity wins regardless of position.
    expect(linkedCss).toMatch(/:root\{[^}]*--accent:\s*#4f46e5/)
    expect(linkedCss).not.toContain(':root:root')
  })
})
