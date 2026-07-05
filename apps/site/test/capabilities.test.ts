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
  it('file-based capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.sitemap).toBe(
      distHas('sitemap.xml') || distHas('sitemap-index.xml')
    )
    // sitemap.xml is a <sitemapindex> of per-type sub-sitemaps (not a flat <urlset>).
    expect(SITE_CAPABILITIES.sitemapIndex).toBe(
      distReadHas('sitemap.xml', /<sitemapindex/)
    )
    // post-sitemap carries Google image-extension entries for entries with images.
    expect(SITE_CAPABILITIES.imageSitemaps).toBe(
      distReadHas('post-sitemap.xml', /<image:image>/)
    )
    expect(SITE_CAPABILITIES.robotsTxt).toBe(distHas('robots.txt'))
    expect(SITE_CAPABILITIES.customError).toBe(distHas('404.html'))
    expect(SITE_CAPABILITIES.llmsTxt).toBe(distHas('llms.txt'))
  })
})
