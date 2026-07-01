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
  // prebuild (gen-blocks + gen-relations) runs via the build script.
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('post/kitchen-sink')
})

describe('related posts widget', () => {
  it('renders a Read Next aside on a post that has tagged siblings', () => {
    expect(html).toContain('class="related-reading"')
    expect(html).toContain('Read Next')
  })
  it('links to the same-locale tagged sibling with a clean default-locale href', () => {
    expect(html).toContain('href="/post/astro-on-the-edge"')
    expect(html).toContain('Astro on the Edge')
  })
  it('ships zero JS for the widget (no island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script(?![^>]*type="application\/ld\+json")[\s>]/)
  })
})
