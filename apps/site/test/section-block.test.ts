import { execSync } from 'node:child_process'
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the section block (#182): content/page/en/section-demo.mdoc
// exercises a soft/wide band with a nested callout, a full-bleed accent band, and a
// background-image band through the real markdoc + theme pipeline. Own-build pattern
// (mirrors hero-block.test.ts) because the background image needs a variant manifest in
// SETU_MEDIA_DIR at build time.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let mediaDir = ''
let html = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'section-media-'))
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
  // Same manifest shape as hero-block.test.ts — section-demo.mdoc reuses the
  // /media/2026/06/test-cat.jpg key so one fixture image serves all suites.
  writeFileSync(
    join(md, 'test-cat.manifest.json'),
    JSON.stringify({
      id: '2026/06/test-cat',
      format: 'webp',
      original: {
        key: '2026/06/test-cat.jpg',
        width: 1000,
        height: 600,
        format: 'jpeg'
      },
      variants: [
        {
          width: 400,
          height: 240,
          key: '2026/06/test-cat-400w.webp',
          contentType: 'image/webp'
        },
        {
          width: 1000,
          height: 600,
          key: '2026/06/test-cat-1000w.webp',
          contentType: 'image/webp'
        }
      ]
    })
  )
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      SETU_MEDIA_DIR: mediaDir,
      PUBLIC_SETU_MEDIA: 'https://cdn.example.test'
    }
  })
  html = page('page/section-demo')
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

function pageCss(): string {
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
  const astroDir = join(appDir, 'dist', '_astro')
  const external = readdirSync(astroDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(astroDir, f), 'utf8'))
    .join('\n')
  return `${inline}\n${external}`
}

describe('section block render (#182)', () => {
  it('renders each band with its background/padding/width classes', () => {
    // sectionClasses(background, padding, width): `blk-section pad-<p> [bg-<b>] [w-<w>]`.
    expect(html).toContain('class="blk-section pad-lg bg-soft w-wide"')
    expect(html).toContain('class="blk-section pad-md bg-accent w-full"')
    expect(html).toContain('class="blk-section pad-lg has-media"')
  })

  it('renders grouped children inside the band, including a nested callout', () => {
    const soft = html.match(
      /class="blk-section pad-lg bg-soft w-wide"[\s\S]*?<\/section>/
    )?.[0]
    expect(soft).toBeDefined()
    expect(soft).toContain('Grouped heading')
    expect(soft).toContain('blk-callout')
    expect(soft).toContain('A callout nested inside a section.')
  })

  it('renders the background image through the real image pipeline (srcset)', () => {
    const media = html.match(
      /class="blk-section pad-lg has-media"[\s\S]*?blk-section-media[\s\S]*?<\/section>/
    )?.[0]
    expect(media).toBeDefined()
    expect(media).toContain('srcset')
    expect(media).toContain('test-cat-1000w.webp')
  })

  it('ships the theme breakout so wide and full render distinctly', () => {
    const css = pageCss()
    expect(css).toContain('.blk-section.w-wide')
    expect(css).toContain('.blk-section.w-full')
    // full = 100vw bleed; wide = page-measure band — the two must not be the same rule
    expect(css).toMatch(/\.blk-section\.w-full[^}]*100vw/)
    expect(css).toMatch(/\.blk-section\.w-wide[^}]*var\(--measure-page\)/)
  })
})
