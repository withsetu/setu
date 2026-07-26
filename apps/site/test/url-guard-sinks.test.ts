import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// #968 — RENDER-SINK coverage for the author-controlled URL guards (#857 + #968).
//
// Why this file exists at all: #972 found Button.astro and Hero.astro citing
// packages/blocks/test/sanitize.test.ts for claims about their RENDERED OUTPUT, while that
// suite only ever calls the helper — it never renders either component, so nothing checked
// that the guard was actually wired to the sink. This suite closes that: it asserts on the
// real HTML produced by a real `astro build` of content/page/en/url-guard-demo.mdoc, which
// authors the dangerous shapes through ordinary Markdoc exactly as an author (or a direct
// content POST) could.
//
// Anti-vacuity: the fixture pairs every rejected shape with a LEGITIMATE one (a safe
// root-relative button, a real provider iframe, a real facade), and the sweeps below assert
// they found something before asserting anything about it — a guard that rejected
// everything would fail here just as loudly as one that rejected nothing.
//
// OWN-BUILD pattern (hero-block.test.ts / gallery-block.test.ts), NOT the shared-dist
// `existsSync` guard — see the media-base note on the build below for why the base has to
// be pinned rather than inherited.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string) =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

/** The origin the built page is imagined to be served from — used only to resolve
 *  root-relative attribute values the way a browser would. */
const ORIGIN = 'https://site.test'
const PAGE_URL = `${ORIGIN}/page/url-guard-demo/`

const decode = (v: string) =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** Every value of `attr` in the document, HTML-entity-decoded. */
const attrValues = (html: string, attr: string): string[] =>
  [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((m) =>
    decode(m[1] ?? '')
  )

/** Every URL-bearing attribute value on the page. */
const urlAttrs = (html: string): string[] => [
  ...attrValues(html, 'href'),
  ...attrValues(html, 'src'),
  ...attrValues(html, 'poster'),
  ...attrValues(html, 'data-embed-url')
]

let html = ''
beforeAll(() => {
  // PUBLIC_SETU_MEDIA='' pins the media base to EMPTY, which is the whole point rather
  // than tidiness: a smuggled authority is only dangerous while media URLs stay relative
  // (the production same-origin topology). Under any absolute base the prefix neutralizes
  // it on its own — `https://cdn.example.test` + `/\t/evil.example/x` resolves back to the
  // CDN — so a suite that inherited a CDN base would assert against a shape that cannot
  // fail. Note vitest's own NODE_ENV also makes an unset PUBLIC_SETU_MEDIA fall back to the
  // dev `http://localhost:4444`, so deleting the variable is NOT enough; it must be ''.
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_SETU_MEDIA: '' }
  })
  html = page('page/url-guard-demo')
}, 180_000)

describe('render-sink URL guards (#857/#968) — built output', () => {
  // ---- the generic sweep: the property that actually matters ----------------------
  //
  // This is the invariant the offset-only check silently violated: a value the guard
  // ACCEPTED as "root-relative" must, once the browser parses it, still be on this origin.
  // Resolving through the real URL parser rather than a regex is the point — it is the
  // same parser that strips tab/LF/CR, so a smuggled authority fails here loudly.
  it('every root-relative href resolves to this origin', () => {
    const rooted = attrValues(html, 'href').filter((v) => v.startsWith('/'))
    expect(rooted.length).toBeGreaterThan(0) // never pass vacuously
    for (const v of rooted)
      expect(
        new URL(v, PAGE_URL).origin,
        `href ${JSON.stringify(v)} escapes the origin`
      ).toBe(ORIGIN)
  })

  it('every root-relative src/poster resolves to this origin', () => {
    const rooted = [
      ...attrValues(html, 'src'),
      ...attrValues(html, 'poster')
    ].filter((v) => v.startsWith('/'))
    expect(rooted.length).toBeGreaterThan(0)
    for (const v of rooted)
      expect(
        new URL(v, PAGE_URL).origin,
        `src ${JSON.stringify(v)} escapes the origin`
      ).toBe(ORIGIN)
  })

  it('no URL attribute carries a dangerous scheme', () => {
    const all = urlAttrs(html)
    expect(all.length).toBeGreaterThan(0)
    for (const v of all)
      expect(v).not.toMatch(/^\s*(javascript|data|vbscript|file):/i)
  })

  it('no URL attribute names the off-origin host the fixture tries to smuggle in', () => {
    // Scoped to attributes on purpose: the fixture's prose explains the attack and names
    // the host, which is documentation, not a sink.
    for (const v of urlAttrs(html)) expect(v).not.toContain('evil.example')
  })

  // ---- per-sink shapes: proves the guard is WIRED, not merely present -------------
  describe('button (safeLinkHref)', () => {
    it('keeps the safe root-relative href as a real link', () => {
      expect(html).toContain(
        '<a href="/page/about" class="setu-button setu-button--primary">Safe root-relative</a>'
      )
    })

    it('renders every smuggled/dangerous href as non-link text, classes intact', () => {
      for (const label of [
        'Tab-smuggled authority',
        'Newline-smuggled authority',
        'Tab-smuggled backslash authority',
        'Dangerous scheme'
      ])
        expect(html).toContain(
          `<span class="setu-button setu-button--primary">${label}</span>`
        )
    })
  })

  describe('hero (safeLinkHref on ctaHref)', () => {
    it('renders the smuggled CTA as a span, never an anchor', () => {
      expect(html).toContain(
        '<span class="blk-hero-cta">Tab-smuggled CTA</span>'
      )
      expect(html).not.toMatch(/<a class="blk-hero-cta"/)
      // the rest of the hero still renders — the guard drops the link, not the block
      expect(html).toContain('<h2 class="blk-hero-headline">Guarded hero</h2>')
    })
  })

  describe('video (resolveMediaSrc on src/poster)', () => {
    it('skips the whole figure when the src is a smuggled authority', () => {
      expect(html).not.toContain('Smuggled src — the whole figure is skipped.')
    })

    it('renders the clip but drops the smuggled poster attribute', () => {
      expect(html).toContain(
        'Smuggled poster — the clip plays, the poster attribute is dropped.'
      )
      // Assert over EVERY <video> on the page rather than slicing around the first
      // "clip.mp4" match: with the guard disabled the rejected first video reappears and
      // its src also contains "clip.mp4", so an index-based slice silently retargets and
      // the assertion passes against vulnerable output (the kill-shot caught exactly this).
      const tags = html.match(/<video\b[^>]*>/g) ?? []
      expect(tags).toHaveLength(1)
      for (const tag of tags) expect(tag).not.toContain('poster=')
    })
  })

  describe('embed (#968 — the block that had no URL validation at all)', () => {
    it('still renders a legitimate provider frame and facade (guards are not a blanket no)', () => {
      expect(html).toContain('src="https://player.example/embed/xyz"')
      expect(html).toContain(
        'data-embed-url="https://player.example/embed/abc"'
      )
      expect(html).toContain('src="https://cdn.example.test/thumb.jpg"')
    })

    it('renders a dangerous fallback url as non-link text, keeping the label visible', () => {
      expect(html).toContain(
        '<span class="blk-embed-fallback">Fallback with a dangerous scheme</span>'
      )
      expect(html).toContain(
        '<span class="blk-embed-fallback">Fallback with a smuggled authority</span>'
      )
    })

    it('falls back to the (safe) outer link when embedUrl is rejected', () => {
      for (const label of [
        'Frame with a dangerous scheme',
        'Frame with a smuggled authority'
      ])
        expect(html).toMatch(
          new RegExp(
            `<a class="blk-embed-fallback" href="https://ok\\.example/watch" rel="noopener noreferrer">\\s*${label}\\s*</a>`
          )
        )
      // Exactly the ONE legitimate frame above — neither rejected embedUrl produced an
      // iframe. Match the ELEMENT, not the class name: the facade's click-to-load script
      // also mentions `blk-embed-iframe` twice as a string literal.
      expect(
        html.match(/<iframe class="blk-embed-iframe"/g) ?? []
      ).toHaveLength(1)
    })

    it('drops a dangerous thumbnail instead of emitting a hostile <img>', () => {
      expect(html).not.toContain('blk-embed-photo')
      expect(html).toMatch(
        /<a class="blk-embed-fallback" href="https:\/\/ok\.example\/photo" rel="noopener noreferrer">\s*Photo with a dangerous thumbnail\s*<\/a>/
      )
    })
  })

  // ---- the iframe sandbox precondition -------------------------------------------
  it('every iframe src is an absolute http(s) URL (the allow-same-origin precondition)', () => {
    // blocks/embed/embed.astro sandboxes provider frames `allow-scripts allow-same-origin`,
    // which is only safe while the framed document is cross-origin. `frameSrc` enforces
    // that by accepting absolute http(s) only; this is the assertion that comment points
    // at, and the fixture's legitimate frame keeps it non-vacuous.
    const srcs = [...html.matchAll(/<iframe[^>]*\ssrc="([^"]*)"/g)].map((m) =>
      decode(m[1] ?? '')
    )
    expect(srcs.length).toBeGreaterThan(0)
    for (const s of srcs) expect(s).toMatch(/^https?:\/\//i)
  })
})
