import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string) =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  if (!existsSync(join(appDir, 'dist', 'page', 'embed-demo', 'index.html'))) {
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  }
  html = page('page/embed-demo')
}, 180_000)

describe('embed block render (#187)', () => {
  it('renders the click-to-load facade with the provider badge + caption', () => {
    expect(html).toContain('class="blk-embed-facade"')
    expect(html).toContain(
      'data-embed-url="https://www.youtube.com/embed/dQw4w9WgXcQ"'
    )
    expect(html).toMatch(/blk-embed-badge">\s*YouTube/)
    expect(html).toContain('A classic, embedded via oEmbed.')
  })

  it('defers the player for privacy — NO provider iframe in the static HTML until played', () => {
    expect(html).not.toMatch(/<iframe[^>]*youtube\.com\/embed/)
    // the poster thumbnail is a plain lazy img, not a network-heavy embed
    expect(html).toContain('class="blk-embed-thumb"')
  })

  it('sandboxes both load paths — cross-origin src keeps same-origin, srcdoc drops it', () => {
    // cross-origin provider src → allow-same-origin is safe (its origin is the provider, not us)
    expect(html).toContain(
      'allow-scripts allow-same-origin allow-presentation allow-popups'
    )
    // srcdoc (script embeds) runs at an opaque origin → sandbox OMITS allow-same-origin
    expect(html).toContain('allow-scripts allow-popups allow-presentation')
  })
})
