import { execSync } from 'node:child_process'
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the hero block (#448): content/page/en/hero-demo.mdoc
// exercises the split-left archetype (image + subhead + CTA) through the real
// markdoc + theme pipeline. Follows featured.test.ts's own-build pattern (NOT the
// embed existsSync guard) because the responsive-srcset assertion needs a variant
// manifest present in SETU_MEDIA_DIR at build time — a dist/ left behind by a
// manifest-less build would render Case 1 (bare <img>, no srcset) and pass vacuously.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let mediaDir = ''
let html = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'hero-media-'))
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
  // Same manifest shape as featured.test.ts — hero-demo.mdoc reuses the
  // /media/2026/06/test-cat.jpg key so one fixture image serves both suites.
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
  html = page('page/hero-demo')
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

describe('hero block render (#448)', () => {
  it('renders the hero root with the archetype + position classes', () => {
    // heroClasses(layout, textPosition) — hero-classes.ts: `blk-hero layout-<layout> pos-<pos>`
    // (default textPosition 'center', default width 'none' adds no w- class).
    expect(html).toContain('class="blk-hero layout-split-left pos-center"')
  })

  it('renders the headline, subhead, and CTA with their real classes', () => {
    expect(html).toMatch(
      /<h2 class="blk-hero-headline">Build on your own terms<\/h2>/
    )
    expect(html).toMatch(
      /<p class="blk-hero-subhead">Git-backed content with an editor your team will actually enjoy\.<\/p>/
    )
    expect(html).toMatch(
      /<a class="blk-hero-cta" href="\/page\/about">Get started<\/a>/
    )
  })

  it('renders the image responsively via @setu/image-astro (srcset from the manifest)', () => {
    expect(html).toContain('class="blk-hero-media"')
    expect(html).toContain(
      'https://cdn.example.test/media/2026/06/test-cat-400w.webp 400w'
    )
    expect(html).toContain(
      'https://cdn.example.test/media/2026/06/test-cat-1000w.webp 1000w'
    )
  })

  it('uses the split-layout sizes hint (50vw above the breakpoint)', () => {
    // sizesForLayout('split-left') — hero-classes.ts
    expect(html).toContain('sizes="(min-width: 768px) 50vw, 100vw"')
  })

  it('does not opt into parallax by default — no data-parallax, and the page ships zero JS', () => {
    expect(html).not.toContain('data-parallax')
    // same zero-JS pattern as query-block.test.ts: a static hero must add no island
    // and no script beyond the SEO JSON-LD payload.
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(
      /<script(?![^>]*type="application\/ld\+json")[\s>]/
    )
  })
})
