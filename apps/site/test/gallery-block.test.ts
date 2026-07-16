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

// Real-build render coverage for the gallery block (#177):
// content/page/en/gallery-demo.mdoc exercises the multi-image grid (columns, gap,
// captions, wide width) through the real markdoc + theme pipeline. Own-build pattern
// (like hero-block.test.ts): the responsive-srcset assertion needs a variant manifest
// present in SETU_MEDIA_DIR at build time.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let mediaDir = ''
let html = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'gallery-media-'))
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
  // Same manifest shape as hero-block.test.ts; gallery-demo.mdoc reuses the
  // /media/2026/06/test-cat.jpg key for both of its images.
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
  html = page('page/gallery-demo')
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

describe('gallery block render (#177)', () => {
  it('renders the gallery root with layout/columns/gap/width classes', () => {
    // galleryClasses(columns, gap, width, layout) — gallery-classes.ts
    expect(html).toContain(
      'class="blk-gallery layout-grid cols-2 gap-small w-wide"'
    )
  })

  it('renders the second gallery as masonry (#533)', () => {
    expect(html).toContain(
      'class="blk-gallery layout-masonry cols-3 gap-medium"'
    )
  })

  it('renders one figure per image with per-image alt', () => {
    const items = html.match(/class="blk-gallery-item"/g) ?? []
    expect(items.length).toBe(3) // 2 in the grid gallery + 1 in the masonry one
    expect(html).toContain('alt="A test cat"')
    expect(html).toContain('alt="Same cat again"')
  })

  it('renders images responsively via @setu/image-astro (srcset from the manifest)', () => {
    expect(html).toContain(
      'https://cdn.example.test/media/2026/06/test-cat-400w.webp 400w'
    )
    expect(html).toContain(
      'https://cdn.example.test/media/2026/06/test-cat-1000w.webp 1000w'
    )
  })

  it('uses the per-column sizes hint (50vw at 2 columns)', () => {
    // sizesForColumns(2) — gallery-classes.ts
    expect(html).toContain(
      'sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, 50vw"'
    )
  })

  it('shows the caption only for the image that has one', () => {
    expect(html).toMatch(
      /<figcaption class="blk-gallery-caption">The classic test cat<\/figcaption>/
    )
    const captions = html.match(/class="blk-gallery-caption"/g) ?? []
    expect(captions.length).toBe(1)
  })

  it('lightbox (#553): tiles link to the full-size original with a dialog + inline script', () => {
    // Default lightbox=on: only the FIRST gallery's 2 tiles are links (the second
    // sets lightbox=false), each pointing at the full-size original (no-JS fallback).
    const links = html.match(/class="blk-gallery-link"/g) ?? []
    expect(links.length).toBe(2)
    expect(html).toContain(
      'href="https://cdn.example.test/media/2026/06/test-cat.jpg"'
    )
    // per-image data for the slideshow
    expect(html).toContain('data-lb-alt="A test cat"')
    expect(html).toContain('data-lb-caption="The classic test cat"')
    // exactly one dialog (the lightbox-off gallery contributes none)
    const dialogs = html.match(/<dialog class="blk-gallery-lightbox"/g) ?? []
    expect(dialogs.length).toBe(1)
    expect(html).toContain('aria-label="Previous image"')
    expect(html).toContain('aria-label="Next image"')
    expect(html).toContain('aria-label="Close"')
    // the progressive-enhancement script ships inline, once
    const scripts = html.match(/__setuGalleryLightbox/g) ?? []
    expect(scripts.length).toBeGreaterThanOrEqual(1)
    // and the lightbox-off masonry gallery has no data-lightbox marker
    expect(html).not.toMatch(/layout-masonry[^"]*" data-lightbox/)
  })

  it('stays framework-free — no astro-island hydration', () => {
    expect(html).not.toContain('astro-island')
  })
})
