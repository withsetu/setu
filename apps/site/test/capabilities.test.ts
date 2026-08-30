import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_CAPABILITIES } from '@setu/core'

const appDir = fileURLToPath(new URL('..', import.meta.url))
// settings.json lives at the repo root. This file is at apps/site/test/, so the repo root is
// three directories up (test/ → site/ → apps/ → root).
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const settingsPath = join(repoRoot, 'settings.json')
let head = ''
let mediaDir = ''
let wroteSettings = false

beforeAll(() => {
  // Seed a settings.json with a non-empty description so the build emits
  // <meta name="description"> — required for the metaDescription capability assertion
  // to be meaningful (Layout.astro only emits the tag when description is non-empty).
  // We also delete any existing dist/index.html to force a rebuild that picks up the
  // seeded settings (the build reuses dist if it exists).
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        general: {
          title: 'Setu Test',
          description: 'A test site description for capability assertions.'
        }
      })
    )
    wroteSettings = true
  }

  // Force a rebuild so the seeded settings are reflected in the output.
  if (existsSync(join(appDir, 'dist', 'index.html'))) {
    rmSync(join(appDir, 'dist', 'index.html'), { force: true })
  }

  mediaDir = mkdtempSync(join(tmpdir(), 'site-media-cap-'))
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
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
          width: 800,
          height: 480,
          key: '2026/06/test-cat-800w.webp',
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
  head = readFileSync(join(appDir, 'dist', 'index.html'), 'utf8')
}, 180_000)

afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
  // Remove the seeded settings.json so the worktree is left clean.
  if (wroteSettings && existsSync(settingsPath))
    rmSync(settingsPath, { force: true })
})

const has = (re: RegExp) => re.test(head)
const distHas = (p: string) => existsSync(join(appDir, 'dist', p))
const distReadHas = (p: string, re: RegExp) =>
  existsSync(join(appDir, 'dist', p)) &&
  re.test(readFileSync(join(appDir, 'dist', p), 'utf8'))

describe('SITE_CAPABILITIES matches real output', () => {
  it('head-tag capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.doctype).toBe(has(/<!doctype html>/i))
    expect(SITE_CAPABILITIES.langAttr).toBe(has(/<html[^>]*\slang=/i))
    expect(SITE_CAPABILITIES.title).toBe(has(/<title/i))
    expect(SITE_CAPABILITIES.metaDescription).toBe(
      has(/<meta\s+name="description"/i)
    )
    expect(SITE_CAPABILITIES.charset).toBe(has(/<meta charset/i))
    expect(SITE_CAPABILITIES.viewport).toBe(has(/name="viewport"/i))
    expect(SITE_CAPABILITIES.canonical).toBe(has(/rel="canonical"/i))
    expect(SITE_CAPABILITIES.openGraph).toBe(has(/property="og:/i))
    expect(SITE_CAPABILITIES.favicon).toBe(has(/rel="icon"/i))
    expect(SITE_CAPABILITIES.themeColor).toBe(has(/name="theme-color"/i))
  })
  // #375: both capabilities were already SHIPPED by packages/image-astro/src/Image.astro and both
  // reported as unverified, so the scorecard under-credited the site. These assert the flags
  // against the REAL build output — a flag that drifts from what the site emits fails here, which
  // is the whole point of the #318 pattern (capability flag -> cap() evaluator -> build assertion).
  it('performance capabilities are accurate', () => {
    // featured-demo is the one seeded entry with a featuredImage, so it is the page that
    // exercises the manifest-backed responsive path.
    const featured = 'post/featured-demo/index.html'

    // What the rubric asks of image optimisation: a modern format, sized for the viewport, with
    // explicit dimensions. Asserted as those three properties rather than as `<picture>`/`<source>`
    // — this fixture's manifest is single-format, so `<picture>` legitimately does not render and
    // requiring it would fail for a reason that has nothing to do with the capability.
    expect(SITE_CAPABILITIES.imageOptimization).toBe(
      distReadHas(featured, /<img[^>]+srcset="[^"]*\.(webp|avif)\s+\d+w/i) &&
        distReadHas(featured, /<img[^>]+sizes="/i) &&
        distReadHas(featured, /<img[^>]+width="\d+"[^>]*height="\d+"/i)
    )

    // Lazy loading is asserted on a page with BELOW-the-fold images, not on featured-demo: the
    // only image there is the LCP one, which is now deliberately eager. Asserting it there would
    // fail for the right behaviour, and asserting it build-wide would pass for the wrong reason.
    //
    // The match requires `srcset` and `loading="lazy"` in the SAME tag, which is Image.astro's
    // own output. A looser "any lazy image on the page" check would be satisfied by the embed
    // block's hand-written <img> and would therefore still pass if Image.astro stopped lazy-
    // loading entirely — a capability assertion that cannot see the component it describes.
    const belowFold = 'page/latest-posts-demo/index.html'
    expect(SITE_CAPABILITIES.lazyLoading).toBe(
      distReadHas(
        belowFold,
        /<img[^>]+srcset=[^>]*loading="lazy"[^>]*decoding="async"/i
      )
    )
  })

  // The half of #375 that is a real defect rather than missing wiring. The rubric's own guidance
  // for performance.lazy-loading says to use it "but never on the LCP element", and Image.astro
  // forced loading="lazy" on EVERY image including the above-the-fold one — delaying the largest
  // paint instead of helping it.
  it('the LCP image is eager and high-priority, not lazy', () => {
    const html = readFileSync(
      join(appDir, 'dist', 'post/featured-demo/index.html'),
      'utf8'
    )
    // The featured image is the first <img> on the page — the LCP candidate.
    const firstImg = /<img\b[^>]*>/i.exec(html)?.[0] ?? ''
    expect(firstImg).not.toBe('')
    expect(firstImg).toMatch(/loading="eager"/)
    expect(firstImg).toMatch(/fetchpriority="high"/)
    expect(firstImg).not.toMatch(/loading="lazy"/)
    // And the opt-in stays opt-in: an ordinary image carries neither hint.
    expect(firstImg).toMatch(/decoding="async"/)
  })

  it('file-based capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.sitemap).toBe(
      distHas('sitemap.xml') || distHas('sitemap-index.xml')
    )
    // sitemap.xml is a <sitemapindex> of per-type sub-sitemaps (not a flat <urlset>).
    expect(SITE_CAPABILITIES.sitemapIndex).toBe(
      distReadHas('sitemap.xml', /<sitemapindex/)
    )
    // post-sitemap carries Google image-extension entries for entries with images. The post
    // sitemap shards at the 50k cap (#859); the first shard is post-sitemap-1.xml.
    expect(SITE_CAPABILITIES.imageSitemaps).toBe(
      distReadHas('post-sitemap-1.xml', /<image:image>/)
    )
    expect(SITE_CAPABILITIES.robotsTxt).toBe(distHas('robots.txt'))
    expect(SITE_CAPABILITIES.customError).toBe(distHas('404.html'))
    expect(SITE_CAPABILITIES.llmsTxt).toBe(distHas('llms.txt'))
    // Translated entries (post/en/kitchen-sink ↔ post/fr/kitchen-sink) emit hreflang alternates.
    expect(SITE_CAPABILITIES.hreflang).toBe(
      distReadHas(
        'post/kitchen-sink/index.html',
        /rel="alternate"\s+hreflang="fr"/
      )
    )
  })
})
