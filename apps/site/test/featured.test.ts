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

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let mediaDir = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'featured-media-'))
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
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})

describe('featured image — post lead/hero', () => {
  it('renders a responsive lead image inside .post-hero for a post that has one', () => {
    const html = page('post/featured-demo')
    const hero =
      html.match(
        /<figure class="post-hero[^"]*"[^>]*>[\s\S]*?<\/figure>/
      )?.[0] ?? ''
    expect(hero).not.toBe('')
    expect(hero).toContain(
      'https://cdn.example.test/media/2026/06/test-cat.jpg'
    )
    expect(hero).toContain(
      'https://cdn.example.test/media/2026/06/test-cat-400w.webp 400w'
    )
  })
  it('renders no .post-hero for a post without a featured image', () => {
    expect(page('post/kitchen-sink')).not.toContain('class="post-hero')
  })
  it('ships zero JS', () => {
    const html = page('post/featured-demo')
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(
      /<script(?![^>]*type="application\/ld\+json")[\s>]/
    )
  })
})
