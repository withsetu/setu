import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type SiteSettings } from '@setu/core'
import { pageSeo } from '../src/lib/seo'

// og:image:* dimensions come from the media manifest, read from SETU_MEDIA_DIR at build time.
// Seed a manifest for /media/2026/06/test-cat.jpg so pageSeo can resolve intrinsic dims (#215).
const settings: SiteSettings = DEFAULT_SETTINGS
const SITE = new URL('https://example.com')
const MEDIA_BASE = 'https://cdn.example'

const meta = (r: ReturnType<typeof pageSeo>, property: string) =>
  r.meta.find((m) => m.property === property)?.content

let prevMediaDir: string | undefined
let dir = ''
beforeAll(() => {
  prevMediaDir = process.env.SETU_MEDIA_DIR
  dir = mkdtempSync(join(tmpdir(), 'seo-dims-'))
  mkdirSync(join(dir, '2026', '06'), { recursive: true })
  writeFileSync(
    join(dir, '2026', '06', 'test-cat.manifest.json'),
    JSON.stringify({
      id: '2026/06/test-cat',
      format: 'webp',
      original: {
        key: '2026/06/test-cat.jpg',
        width: 1200,
        height: 630,
        format: 'jpeg'
      },
      variants: []
    })
  )
  process.env.SETU_MEDIA_DIR = dir
})

afterAll(() => {
  if (prevMediaDir === undefined) delete process.env.SETU_MEDIA_DIR
  else process.env.SETU_MEDIA_DIR = prevMediaDir
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('pageSeo og:image dimensions (#215)', () => {
  it('resolves og:image:width/height/type/alt from the media manifest for a featured image', () => {
    const r = pageSeo(SITE, '/post/hello/', MEDIA_BASE, settings, {
      title: 'Hello World',
      imagePath: '/media/2026/06/test-cat.jpg'
    })
    expect(meta(r, 'og:image')).toBe(
      'https://cdn.example/media/2026/06/test-cat.jpg'
    )
    expect(meta(r, 'og:image:width')).toBe('1200')
    expect(meta(r, 'og:image:height')).toBe('630')
    expect(meta(r, 'og:image:type')).toBe('image/jpeg')
    // Alt mirrors the theme's featured-image convention (alt = page title).
    expect(meta(r, 'og:image:alt')).toBe('Hello World')
  })

  it('emits a bare og:image (no dimensions) for an external image with no manifest', () => {
    const r = pageSeo(SITE, '/post/ext/', MEDIA_BASE, settings, {
      title: 'External',
      imagePath: 'https://elsewhere.example/x.jpg'
    })
    expect(meta(r, 'og:image')).toBe('https://elsewhere.example/x.jpg')
    expect(meta(r, 'og:image:width')).toBeUndefined()
    expect(meta(r, 'og:image:height')).toBeUndefined()
    expect(meta(r, 'og:image:type')).toBeUndefined()
  })

  it('emits no og:image tags at all when the page has no image', () => {
    const r = pageSeo(SITE, '/post/none/', MEDIA_BASE, settings, {
      title: 'No image'
    })
    expect(meta(r, 'og:image')).toBeUndefined()
    expect(meta(r, 'og:image:width')).toBeUndefined()
  })
})
