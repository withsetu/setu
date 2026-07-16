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
  it('renders the gallery root with columns/gap/width classes', () => {
    // galleryClasses(columns, gap, width) — gallery-classes.ts
    expect(html).toContain('class="blk-gallery cols-2 gap-small w-wide"')
  })

  it('renders one figure per image with per-image alt', () => {
    const items = html.match(/class="blk-gallery-item"/g) ?? []
    expect(items.length).toBe(2)
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

  it('ships zero JS — no island, no script beyond SEO JSON-LD', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(
      /<script(?![^>]*type="application\/ld\+json")[\s>]/
    )
  })
})
