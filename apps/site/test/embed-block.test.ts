import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')
const page = (route: string) =>
  readFileSync(join(distDir, route, 'index.html'), 'utf8')

/** Markers from the fixtures in content/page/en/embed-demo.mdoc — a dist built before
 *  they existed would silently skip the srcdoc halves (#1115) or the off-allowlist cases
 *  (#1246), so the absence of either forces a rebuild rather than a vacuous pass. */
const FIXTURE_MARKERS = [
  'Script embed, static srcdoc',
  'Bad dimensions 1246',
  'Player host look-alike 1246'
]

let html = ''
beforeAll(() => {
  const demo = join(distDir, 'page', 'embed-demo', 'index.html')
  if (
    !existsSync(demo) ||
    !FIXTURE_MARKERS.every((m) => readFileSync(demo, 'utf8').includes(m))
  ) {
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
})

// ---- #1115: the iframe sandbox, asserted on LOCATED elements ---------------------------
//
// blocks/embed/embed.astro has four load paths, and every one ends in an <iframe>:
//   static  — `src`    iframe (embedUrl, no thumbnail)   → url-guard-demo's provider frame
//   static  — `srcdoc` iframe (html, no thumbnail)       → embed-demo's static script embed
//   facade  — click → `src`    iframe (embedUrl + thumb) → embed-demo's YouTube facade
//   facade  — click → `srcdoc` iframe (html + thumb)     → embed-demo's facade script embed
// The static halves are read off the parsed built HTML; the facade halves are produced by
// actually RUNNING the built page's click-to-load script in jsdom and clicking each facade,
// so what is asserted is the attribute the shipped code really sets — not a string that
// happens to appear somewhere in the document.
//
// The comparison is the FULL token set, exactly. A substring/prefix match is what made the
// previous version of this test unfailable: `allow-scripts allow-popups allow-presentation`
// is a prefix of the same list with `allow-same-origin` appended — and a srcdoc frame is
// same-origin by default, so that one extra token would let it reach this page's DOM and
// strip its own sandbox.

/** A provider frame's document is cross-origin (frameSrc admits absolute http(s) only —
 *  apps/site/test/url-guard-sinks.test.ts), so allow-same-origin cannot reach this page. */
const SRC_SANDBOX = [
  'allow-popups',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts'
]
/** A srcdoc frame would inherit THIS page's origin — so no allow-same-origin, ever. */
const SRCDOC_SANDBOX = ['allow-popups', 'allow-presentation', 'allow-scripts']

/** Sorted token list, or null when the attribute is absent (absent ≠ empty: an empty
 *  sandbox is the strictest one, a missing one is no sandbox at all). */
const sandboxTokens = (el: Element): string[] | null => {
  const v = el.getAttribute('sandbox')
  return v === null ? null : v.split(/\s+/).filter(Boolean).sort()
}

type Frame = { page: string; kind: 'src' | 'srcdoc'; sandbox: string[] | null }

const classify = (page: string, iframe: Element): Frame => ({
  page,
  // srcdoc wins over src in the browser, so a frame with both is a srcdoc frame.
  kind: iframe.hasAttribute('srcdoc') ? 'srcdoc' : 'src',
  sandbox: sandboxTokens(iframe)
})

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return htmlFiles(p)
    return name.endsWith('.html') ? [p] : []
  })

/** Every <iframe> in the whole build, as shipped in the static HTML. */
const staticFrames = (): Frame[] =>
  htmlFiles(distDir).flatMap((file) => {
    const doc = new JSDOM(readFileSync(file, 'utf8')).window.document
    return [...doc.querySelectorAll('iframe')].map((f) => classify(file, f))
  })

/** The facade script's text as the built page ships it — inline, or (if Astro ever stops
 *  inlining it) the external module it points at. */
const scriptSource = (s: HTMLScriptElement): string => {
  const src = s.getAttribute('src')
  return src
    ? readFileSync(join(distDir, src.replace(/^\//, '')), 'utf8')
    : (s.textContent ?? '')
}

/** Load each page that has a facade, run its own click-to-load script, click every facade,
 *  and return the iframes the script created. */
const facadeFrames = (): { frames: Frame[]; clicked: number } => {
  let clicked = 0
  const frames = htmlFiles(distDir).flatMap((file) => {
    const raw = readFileSync(file, 'utf8')
    if (!raw.includes('blk-embed-facade')) return []
    const dom = new JSDOM(raw, { runScripts: 'outside-only' })
    const { document } = dom.window
    const scripts = [
      ...document.querySelectorAll<HTMLScriptElement>('script[type="module"]')
    ]
      .map(scriptSource)
      .filter((code) => code.includes('blk-embed-facade'))
    expect(scripts, `${file}: facade markup but no facade script`).toHaveLength(
      1
    )
    // The facade script is self-contained (no imports), so a classic eval runs it as-is.
    dom.window.eval(scripts[0])
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>('.blk-embed-facade')
    ]
    const before = new Set(document.querySelectorAll('iframe'))
    for (const b of buttons) b.click()
    clicked += buttons.length
    return [...document.querySelectorAll('iframe')]
      .filter((f) => !before.has(f))
      .map((f) => classify(file, f))
  })
  return { frames, clicked }
}

describe('embed iframe sandbox — every load path (#1115)', () => {
  it('static <iframe>s: src frames carry exactly the provider sandbox, srcdoc frames exactly the opaque one', () => {
    const frames = staticFrames()
    // Anti-vacuity: both static paths must be present in the build, or this proves nothing.
    expect(frames.filter((f) => f.kind === 'src').length).toBeGreaterThan(0)
    expect(frames.filter((f) => f.kind === 'srcdoc').length).toBeGreaterThan(0)
    for (const f of frames)
      expect(f.sandbox, `${f.kind} iframe in ${f.page}`).toEqual(
        f.kind === 'src' ? SRC_SANDBOX : SRCDOC_SANDBOX
      )
  })

  it('facade click-to-load: the script sets exactly the provider sandbox on src frames and exactly the opaque one on srcdoc frames', () => {
    const { frames, clicked } = facadeFrames()
    // Every click must produce a frame — a facade that silently does nothing would
    // otherwise drop out of the assertion below.
    expect(frames).toHaveLength(clicked)
    expect(frames.filter((f) => f.kind === 'src').length).toBeGreaterThan(0)
    expect(frames.filter((f) => f.kind === 'srcdoc').length).toBeGreaterThan(0)
    for (const f of frames)
      expect(f.sandbox, `facade-built ${f.kind} iframe in ${f.page}`).toEqual(
        f.kind === 'src' ? SRC_SANDBOX : SRCDOC_SANDBOX
      )
  })
})

// ---- #1246: the provider allowlist, enforced at the render sink ---------------------
//
// The oEmbed resolver only ever produces registered providers, but `.mdoc` content can be
// written directly (raw source, the commit API), so embed.astro re-checks at render time:
// `embedUrl` is framed only when its host belongs to a registered provider, and `html` is
// rendered (srcdoc) only when the entry's `url` does. A failing check degrades to the plain
// outbound link — never to nothing. The legitimate provider frame/facade/srcdoc fixtures
// asserted above (and in url-guard-sinks.test.ts) are the anti-vacuity half: the guard must
// still let registered providers through.
describe('embed provider allowlist at render (#1246)', () => {
  const doc = () => new JSDOM(html).window.document

  const fallbackHref = (title: string): string | null => {
    const a = [...doc().querySelectorAll('a.blk-embed-fallback')].find(
      (el) => el.textContent?.trim() === title
    )
    return a ? a.getAttribute('href') : null
  }

  it('does not frame an embedUrl whose host is not a registered provider (incl. a look-alike)', () => {
    expect(html).not.toContain('evil.example')
    expect(fallbackHref('Off-list frame 1246')).toBe(
      'https://ok.example/off-list-frame'
    )
    // A thumbnail does not rescue it: no facade for a look-alike host either.
    expect(fallbackHref('Look-alike facade 1246')).toBe(
      'https://ok.example/look-alike'
    )
  })

  it("frames a provider's registered player host, but not a look-alike of it", () => {
    const frame = doc().querySelector('iframe[title="Player host 1246"]')
    expect(frame?.getAttribute('src')).toBe(
      'https://video.wordpress.com/embed/OWeq4IPf'
    )
    expect(html).not.toContain('evil-video.wordpress.com')
    expect(fallbackHref('Player host look-alike 1246')).toBe(
      'https://ok.example/player-look-alike'
    )
  })

  it('does not render html (srcdoc) for an entry whose url is not a registered provider', () => {
    expect(html).not.toContain('offlist-srcdoc-1246')
    expect(html).not.toContain('offlist-facade-1246')
    expect(fallbackHref('Off-list srcdoc 1246')).toBe(
      'https://ok.example/off-list-html'
    )
    expect(fallbackHref('Off-list srcdoc facade 1246')).toBe(
      'https://ok.example/off-list-html-facade'
    )
  })

  it('still renders html for a registered provider url (the guard is not a blanket no)', () => {
    const srcdocs = [...doc().querySelectorAll('iframe[srcdoc]')].map((f) =>
      f.getAttribute('srcdoc')
    )
    expect(srcdocs).toContain('<blockquote>A script-based embed</blockquote>')
    expect(html).toContain('A script-based embed behind a poster')
  })
})

describe('embed width/height clamp (#1246)', () => {
  /** Every inline aspect-ratio the embed block writes (static frames + facades). */
  const aspects = (): string[] =>
    [
      ...new JSDOM(html).window.document.querySelectorAll(
        '.blk-embed-frame, .blk-embed-facade'
      )
    ].map((el) => el.getAttribute('style') ?? '')

  it('falls back to 16 / 9 instead of writing non-positive dimensions into the style', () => {
    const iframe = new JSDOM(html).window.document.querySelector(
      'iframe[title="Bad dimensions 1246"]'
    )
    expect(iframe).not.toBeNull()
    expect(iframe?.parentElement?.getAttribute('style')).toBe(
      'aspect-ratio:16 / 9'
    )
  })

  it('every embed aspect-ratio is two positive numbers', () => {
    const styles = aspects()
    expect(styles.length).toBeGreaterThan(0)
    // The YouTube facade's real 480x270 must survive the clamp (anti-vacuity).
    expect(styles).toContain('aspect-ratio:480 / 270')
    for (const s of styles)
      expect(s).toMatch(/^aspect-ratio:\d+(\.\d+)? \/ \d+(\.\d+)?$/)
  })
})
