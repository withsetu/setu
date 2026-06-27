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
  html = page('post/kitchen-sink')
})

describe('related posts v2 — image cards', () => {
  it('renders the configurable heading (default Read Next)', () => {
    expect(html).toContain('class="related-reading"')
    expect(html).toContain('Read Next')
  })
  it('renders a featured-image thumbnail for a related post that has one', () => {
    // featured-demo is related to kitchen-sink and has featuredImage /media/2026/06/test-cat.jpg
    expect(html).toContain('href="/post/featured-demo"')
    expect(html).toMatch(/class="related-card__media"[\s\S]*?\/media\/2026\/06\/test-cat\.jpg/)
  })
  it('still links related posts by title', () => {
    expect(html).toContain('href="/post/astro-on-the-edge"')
  })
  it('ships zero JS', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
