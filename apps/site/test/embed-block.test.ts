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

/** Marker from the srcdoc fixtures in content/page/en/embed-demo.mdoc — a dist built
 *  before they existed would silently skip the srcdoc halves, so its absence forces a
 *  rebuild rather than a vacuous pass. */
const SRCDOC_FIXTURE_MARKER = 'Script embed, static srcdoc'

let html = ''
beforeAll(() => {
  const demo = join(distDir, 'page', 'embed-demo', 'index.html')
  if (
    !existsSync(demo) ||
    !readFileSync(demo, 'utf8').includes(SRCDOC_FIXTURE_MARKER)
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
