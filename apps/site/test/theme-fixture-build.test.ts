import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { optionsToCss } from '@setu/core'
import { themeOptions as fixtureDeclaration } from '@setu/theme-fixture/options'

/**
 * #1298: the theme contract, proven by a second theme rather than by prose.
 *
 * `@setu/theme-fixture` does none of the things a theme used to have to know to do: it never
 * calls optionsToCss, names its typeface option `typeface` (not `font`), and ships no width
 * primitives or post-card internals. This suite builds the real site through it — with the
 * Customizer values CHANGED from the theme's defaults — and checks that each of those still
 * reaches the built pages because Setu supplies it.
 *
 * It builds into its own out dir from a copy of the content, so the shared dist/ the other suites
 * read keeps theme-default's output.
 */
const appDir = fileURLToPath(new URL('..', import.meta.url))
const repoContent = fileURLToPath(new URL('../../../content', import.meta.url))
const fixtureDir = fileURLToPath(
  new URL('../../../packages/theme-fixture/', import.meta.url)
)

/** Every option moved off its default, so nothing below can pass on defaults alone. */
const chosen = { highlight: '#2f6f4f', typeface: 'literata', measure: 'roomy' }

let root: string
let dist: string
let build: { status: number | null; output: string }

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return htmlFiles(p)
    return name.endsWith('.html') ? [p] : []
  })
const page = (path: string) =>
  readFileSync(join(dist, path, 'index.html'), 'utf8')
/** Text of every stylesheet a page links (the bundled theme + block CSS). */
const linkedCss = (html: string) =>
  [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => readFileSync(join(dist, m[1]!.replace(/^\//, '')), 'utf8'))
    .join('\n')
/** A page's own CSS: linked sheets plus the inline <style> blocks the purge leaves in place. */
const pageCss = (html: string) =>
  linkedCss(html) +
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'setu-theme-fixture-'))
  const content = join(root, 'content')
  cpSync(repoContent, content, { recursive: true })
  // Per-run frontmatter key: Astro's glob loader reuses a digest-identical cached entry without
  // re-checking its path, which would point later builds at this deleted temp copy — see
  // entry-id-parity.test.ts.
  const stamp = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) stamp(p)
      else if (name.endsWith('.mdoc'))
        writeFileSync(
          p,
          readFileSync(p, 'utf8').replace(
            /^---\n/,
            `---\nfixtureRun: ${basename(root)}\n`
          )
        )
    }
  }
  stamp(content)
  // What the Customizer publishes: the content-repo root's theme-options.json.
  writeFileSync(join(root, 'theme-options.json'), JSON.stringify(chosen))
  dist = join(root, 'dist')
  const run = spawnSync('pnpm', ['build', '--outDir', dist], {
    cwd: appDir,
    env: {
      ...process.env,
      SETU_CONTENT_DIR: content,
      SETU_TEST_THEME: '@setu/theme-fixture'
    },
    encoding: 'utf8'
  })
  build = { status: run.status, output: `${run.stdout}\n${run.stderr}` }
}, 240_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the site builds and renders through a second theme', () => {
  it('builds', () => {
    expect(build.status, build.output.slice(-3000)).toBe(0)
  })

  it('renders every page with the fixture theme, never theme-default', () => {
    const pages = htmlFiles(dist)
    expect(pages.length).toBeGreaterThan(10)
    for (const p of pages) {
      const html = readFileSync(p, 'utf8')
      if (!html.includes('</head>')) continue // redirect stubs carry no theme
      expect(html, relative(dist, p)).toContain('class="fx-masthead"')
      expect(html, relative(dist, p)).not.toContain('class="site-header"')
    }
  })
})

describe("Setu applies the theme's options, under the theme's own keys", () => {
  it('the theme never calls optionsToCss itself', () => {
    for (const f of readdirSync(fixtureDir).filter((f) => f.endsWith('.astro')))
      expect(readFileSync(join(fixtureDir, f), 'utf8'), f).not.toContain(
        'optionsToCss'
      )
  })

  it('writes the override for the CHANGED values into the page head', () => {
    const css = optionsToCss(fixtureDeclaration, chosen)
    expect(css).toContain('--accent: #2f6f4f;')
    expect(css).toContain('--measure-post: 46rem;')
    expect(css).toMatch(/--font-body: 'Literata Variable'/)
    expect(page('post/kitchen-sink')).toContain(`<style>${css}</style></head>`)
  })
})

describe("the chosen typeface's fonts are bundled (found by role, not by the key `font`)", () => {
  it('emits @font-face for the selected family and the mono face, and not the default family', () => {
    const css = linkedCss(page('post/kitchen-sink'))
    expect(css).toMatch(/@font-face/)
    expect(css).toMatch(/font-family:\s*Literata Variable/i)
    expect(css).toMatch(/font-family:\s*Fira Code Variable/i)
    expect(css).not.toMatch(/font-family:\s*Fraunces Variable/i)
    expect(
      readdirSync(join(dist, '_astro')).some((f) => f.endsWith('.woff2'))
    ).toBe(true)
  })
})

describe('Wide/Full and post cards work without the theme implementing them', () => {
  it('ships no width primitives and no post-card internals of its own', () => {
    for (const f of readdirSync(fixtureDir).filter((f) =>
      /\.(css|astro)$/.test(f)
    )) {
      const src = readFileSync(join(fixtureDir, f), 'utf8')
      expect(src, f).not.toMatch(/\.w-(wide|full)\b/)
      expect(src, f).not.toMatch(/\.align-(wide|full)\b/)
    }
  })

  it('a Full-width section on the built page gets its breakout rule anyway', () => {
    const html = page('page/section-demo')
    expect(html).toMatch(/class="[^"]*blk-section[^"]*w-full/)
    expect(pageCss(html)).toMatch(/\.blk-section\.w-full[^{]*\{[^}]*100vw/)
  })

  it('query cards on the built page get their card internals anyway', () => {
    const html = page('page/query-demo')
    expect(html).toContain('setu-post-card__title')
    expect(pageCss(html)).toMatch(/\.setu-post-card__title[^{]*\{/)
  })

  it('the out dir is not the shared dist/ the other suites read', () => {
    expect(existsSync(dist)).toBe(true)
    expect(dist.startsWith(appDir)).toBe(false)
  })
})
