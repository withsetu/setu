import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Complements the "ships zero JS" tests: those prove a plain image ships NO script (zero-JS
// default). This proves the reveal island IS emitted when an image opts into LQIP blur-up — so
// the gate added in Image.astro can't silently disable the fade-in.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string => readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let mediaDir = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'blurup-media-'))
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
  // Same manifest as featured.test, PLUS an `lqip` placeholder → the blur-up (Case 4) path.
  writeFileSync(
    join(md, 'test-cat.manifest.json'),
    JSON.stringify({
      id: '2026/06/test-cat',
      format: 'webp',
      lqip: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      original: { key: '2026/06/test-cat.jpg', width: 1000, height: 600, format: 'jpeg' },
      variants: [
        { width: 400, height: 240, key: '2026/06/test-cat-400w.webp', contentType: 'image/webp' },
        { width: 1000, height: 600, key: '2026/06/test-cat-1000w.webp', contentType: 'image/webp' },
      ],
    }),
  )
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_MEDIA_DIR: mediaDir, PUBLIC_SETU_MEDIA: 'https://cdn.example.test' },
  })
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

describe('blur-up reveal island (LQIP opt-in)', () => {
  it('emits the blur-up wrapper + reveal script when an image has LQIP', () => {
    const html = page('post/featured-demo')
    expect(html, 'blur-up wrapper').toContain('blk-blurup')
    expect(html, 'reveal-on-load handler').toMatch(/onload="[^"]*is-loaded/)
    expect(html, 'the gated reveal <script> ships for the opt-in island').toMatch(/<script[\s>]/)
    expect(html).toContain('__setuBlurup')
  })
})
