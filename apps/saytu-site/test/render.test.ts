import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
let html = ''

function page(route: string): string {
  return readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
}

beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('post/en/kitchen-sink')
})

describe('render pipeline — standard nodes', () => {
  it('renders the frontmatter title as the page h1', () => {
    expect(html).toContain('<h1>Kitchen Sink</h1>')
  })
  it('renders marks and a link', () => {
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })
  it('renders a body subheading (H2, not the title H1)', () => {
    expect(html).toContain('<h2 id="a-subheading">A subheading</h2>')
  })
})

describe('render pipeline — callout', () => {
  it('renders the callout via the React core with attrs + body', () => {
    expect(html).toContain('class="callout callout--warning"')
    expect(html).toContain('data-component="Callout.tsx"')
    expect(html).toContain('<p class="callout__title">Heads up</p>')
    expect(html).toContain('<strong>bold</strong>')
  })
  it('ships zero JS for static content (no hydration island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})
