import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_CAPABILITIES } from '@setu/core'

const appDir = fileURLToPath(new URL('..', import.meta.url))
let head = ''
let mediaDir = ''

beforeAll(() => {
  // Mirror render.test.ts: set up a minimal media dir so the build doesn't fail on
  // missing manifests, then build (or reuse the dist/ render.test already produced).
  if (!existsSync(join(appDir, 'dist', 'index.html'))) {
    mediaDir = mkdtempSync(join(tmpdir(), 'site-media-cap-'))
    const md = join(mediaDir, '2026', '06')
    mkdirSync(md, { recursive: true })
    writeFileSync(
      join(md, 'test-cat.manifest.json'),
      JSON.stringify({
        id: '2026/06/test-cat', format: 'webp',
        original: { key: '2026/06/test-cat.jpg', width: 1000, height: 600, format: 'jpeg' },
        variants: [
          { width: 400, height: 240, key: '2026/06/test-cat-400w.webp', contentType: 'image/webp' },
          { width: 800, height: 480, key: '2026/06/test-cat-800w.webp', contentType: 'image/webp' },
          { width: 1000, height: 600, key: '2026/06/test-cat-1000w.webp', contentType: 'image/webp' },
        ],
      }),
    )
    execSync('pnpm build', {
      cwd: appDir,
      stdio: 'inherit',
      env: { ...process.env, SETU_MEDIA_DIR: mediaDir, PUBLIC_SETU_MEDIA: 'https://cdn.example.test' },
    })
  }
  head = readFileSync(join(appDir, 'dist', 'index.html'), 'utf8')
}, 180_000)

afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

const has = (re: RegExp) => re.test(head)
const distHas = (p: string) => existsSync(join(appDir, 'dist', p))

describe('SITE_CAPABILITIES matches real output', () => {
  it('head-tag capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.charset).toBe(has(/<meta charset/i))
    expect(SITE_CAPABILITIES.viewport).toBe(has(/name="viewport"/i))
    expect(SITE_CAPABILITIES.canonical).toBe(has(/rel="canonical"/i))
    expect(SITE_CAPABILITIES.openGraph).toBe(has(/property="og:/i))
    expect(SITE_CAPABILITIES.favicon).toBe(has(/rel="icon"/i))
    expect(SITE_CAPABILITIES.themeColor).toBe(has(/name="theme-color"/i))
  })
  it('file-based capabilities are accurate', () => {
    expect(SITE_CAPABILITIES.sitemap).toBe(distHas('sitemap.xml') || distHas('sitemap-index.xml'))
    expect(SITE_CAPABILITIES.robotsTxt).toBe(distHas('robots.txt'))
    expect(SITE_CAPABILITIES.customError).toBe(distHas('404.html'))
    expect(SITE_CAPABILITIES.llmsTxt).toBe(distHas('llms.txt'))
  })
})
