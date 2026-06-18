import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
let html = ''

function page(route: string): string {
  return readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
}

function themeCss(): string {
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  if (styleBlocks.includes('.prose')) return styleBlocks
  const astroDir = join(appDir, 'dist', '_astro')
  return readdirSync(astroDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(astroDir, f), 'utf8'))
    .join('\n')
}

beforeAll(() => {
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })
  html = page('post/kitchen-sink')
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
  it('renders the callout via the shared @setu/blocks core with attrs + body', () => {
    expect(html).toContain('blk-callout tone-amber')
    expect(html).toContain('<svg')
    expect(html).toContain('class="callout-title">Heads up</span>')
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

describe('render pipeline — table column alignment', () => {
  it('emits text-align on aligned columns (clean CSS, not deprecated align attr)', () => {
    expect(html).toContain('<th style="text-align:center">Center</th>')
    expect(html).toContain('<th style="text-align:right">Right</th>')
    expect(html).toContain('<td style="text-align:right">c1</td>')
    expect(html).not.toContain('<td align=')
  })
})

describe('render pipeline — baseline + passthrough', () => {
  it('renders a hard break (static passthrough content)', () => {
    expect(html).toContain('<br')
  })
  it('emits exactly one h1 (the title); body uses h2+', () => {
    const h1s = html.match(/<h1[\s>]/g) ?? []
    expect(h1s.length).toBe(1)
  })
  it('wires the baseline stylesheet (inlined CSS rule present)', () => {
    // CSS is inlined by Astro; assert a known rule from @setu/blocks callout.css appears in the built HTML.
    expect(html).toContain('.blk-callout')
  })
})

describe('render pipeline — locale URLs', () => {
  it('omits the default locale (en) from the URL', () => {
    expect(() => page('post/kitchen-sink')).not.toThrow()
    expect(() => page('post/en/kitchen-sink')).toThrow()
  })
  it('keeps a non-default locale segment in the URL', () => {
    expect(page('post/fr/bonjour')).toContain('<h1>Bonjour</h1>')
  })
})

describe('default theme — templates by collection', () => {
  it('renders a post with the narrow Post template', () => {
    expect(page('post/kitchen-sink')).toContain('class="prose measure-post"')
  })
  it('renders a page with the wider Page template', () => {
    const about = page('page/about')
    expect(about).toContain('class="prose measure-page"')
    expect(about).toContain('<h1>About</h1>')
  })
  it('renders the home page entry at the site root', () => {
    const home = page('') // dist/index.html
    expect(home).toContain('<h1>Welcome to Setu</h1>')
    expect(home).toContain('class="prose measure-page"')
  })
  it('carries the entry locale as <html lang>', () => {
    expect(page('post/fr/bonjour')).toContain('lang="fr"')
    expect(page('post/kitchen-sink')).toContain('lang="en"')
  })
})

describe('default theme — shell + tokens', () => {
  it('renders the header (brand + nav) and footer', () => {
    expect(html).toContain('class="site-header"')
    expect(html).toContain('class="brand"')
    expect(html).toContain('Setu')
    expect(html).toContain('class="site-footer"')
    expect(html).toContain('Built with Setu')
  })
  it('self-hosts the theme web fonts (no Google Fonts)', () => {
    expect(html).not.toContain('fonts.googleapis.com')
    // Hanken Grotesk self-hosts via @fontsource; family registered as 'Hanken Grotesk Variable'.
    // (Minifier strips quotes in the bundled CSS — match the built form.)
    expect(themeCss()).toMatch(/font-family:\s*['"]?Hanken Grotesk Variable['"]?/)
  })
  it('applies the theme tokens (callout themed, not bare fallback)', () => {
    expect(html).toContain('#4f46e5') // --accent from theme.css
    expect(html).toContain('class="blk-callout tone-amber"')
    expect(html).toContain('<svg')
  })
  it('ships zero JS (no hydration island/script)', () => {
    expect(html).not.toContain('astro-island')
    expect(html).not.toMatch(/<script[\s>]/)
  })
})

describe('default theme — prose typography', () => {
  it('drives prose typography from the theme tokens', () => {
    const css = themeCss()
    expect(css).toMatch(/\.prose[^{]*\{[^}]*var\(--font-body\)/)
    expect(css).toMatch(/\.prose h2[^{]*\{[^}]*var\(--font-heading\)/)
    expect(css).toMatch(/\.prose a[^{]*\{[^}]*var\(--accent\)/)
  })
  it('no longer hardcodes system-ui for prose body', () => {
    const css = themeCss()
    expect(css).not.toMatch(/\.prose\s*\{[^}]*system-ui/)
  })
})
