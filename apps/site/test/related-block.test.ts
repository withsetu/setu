import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let html = ''
beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('page/related-demo')
})

describe('{% related %} block', () => {
  it('renders a Related section with the curated posts', () => {
    expect(html).toContain('class="setu-related"')
    expect(html).toContain('Related')
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toContain('href="/post/astro-on-the-edge"')
  })
  it('preserves the authored order (featured-demo before astro-on-the-edge)', () => {
    expect(html.indexOf('/post/featured-demo')).toBeLessThan(
      html.indexOf('/post/astro-on-the-edge')
    )
  })
  it('renders a thumbnail for a curated post that has a featured image', () => {
    expect(html).toMatch(
      /class="setu-post-card__media"[\s\S]*?\/media\/2026\/06\/test-cat\.jpg/
    )
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(
      /<script(?![^>]*type="application\/ld\+json")[\s>]/
    )
  })
})
