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

describe('render pipeline — text align', () => {
  it('emits text-align for non-default alignment', () => {
    expect(html).toContain('<p style="text-align:center">This paragraph is centered.</p>')
    expect(html).toContain('<p style="text-align:right">This paragraph is right-aligned.</p>')
  })
  it('leaves default-aligned paragraphs clean', () => {
    expect(html).toContain('<p>A paragraph with <strong>bold</strong>')
  })
})

describe('render pipeline — sub/superscript', () => {
  it('renders sub and sup', () => {
    expect(html).toContain('H<sub>2</sub>O')
    expect(html).toContain('mc<sup>2</sup>')
  })
})

describe('render pipeline — checklist', () => {
  it('renders read-only checkboxes from GFM task markers', () => {
    expect(html).toContain('<li class="task" data-checked="false"><input type="checkbox" disabled')
    expect(html).toContain('<li class="task" data-checked="true"><input type="checkbox" checked disabled')
    expect(html).toContain('A checked task')
  })
  it('does not leak the literal marker text', () => {
    expect(html).not.toContain('[ ] An unchecked task')
    expect(html).not.toContain('[x] A checked task')
  })
  it('leaves non-task bullet items as plain <li>', () => {
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
  })
})
