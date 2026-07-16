import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Real-build render coverage for the video block (#178): content/page/en/video-demo.mdoc
// exercises a controls+poster+caption video and an autoplay clip through the real
// markdoc + theme pipeline. Follows embed-block.test.ts's shared-dist pattern (the
// video renderer reads no media manifest, so any dist/ works).

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string) =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  if (!existsSync(join(appDir, 'dist', 'page', 'video-demo', 'index.html'))) {
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  }
  html = page('page/video-demo')
}, 180_000)

describe('video block render (#178)', () => {
  it('renders a plain HTML5 <video> with controls, poster and metadata preload', () => {
    expect(html).toContain('<figure class="blk-video"')
    expect(html).toMatch(
      /<video class="blk-video-player"[^>]*src="[^"]*\/media\/2026\/07\/clip\.mp4"/
    )
    expect(html).toMatch(/poster="[^"]*\/media\/2026\/06\/test-cat\.jpg"/)
    expect(html).toContain('preload="metadata"')
    // first clip: controls on (default), no autoplay/loop/muted
    const first = html.slice(html.indexOf('clip.mp4') - 400)
    expect(first.slice(0, 500)).toContain('controls')
  })

  it('renders the caption as a figcaption', () => {
    expect(html).toMatch(
      /<figcaption class="blk-video-caption">A self-hosted clip with a poster\.<\/figcaption>/
    )
  })

  it('autoplay clip is forced muted + playsinline and carries the wide intent class', () => {
    const i = html.indexOf('ambient.webm')
    expect(i).toBeGreaterThan(-1)
    const tagStart = html.lastIndexOf('<video', i)
    const tag = html.slice(tagStart, html.indexOf('>', i) + 1)
    expect(tag).toContain('autoplay')
    expect(tag).toContain('muted')
    expect(tag).toContain('playsinline')
    expect(tag).toContain('loop')
    expect(tag).not.toContain('controls')
    const figStart = html.lastIndexOf('<figure', tagStart)
    expect(html.slice(figStart, tagStart)).toContain('blk-video w-wide')
  })

  it('ships zero JS — no island, no script beyond the SEO JSON-LD payload', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script(?![^>]*type="application\/ld\+json")[\s>]/)
  })
})
