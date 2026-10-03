import { readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PurgeCSS, defaultOptions } from 'purgecss'

/** Parse one safelist entry: "/pattern/flags" → RegExp, anything else → exact string. */
function toMatcher(entry) {
  if (typeof entry !== 'string') return null
  const re = entry.match(/^\/(.*)\/([a-z]*)$/)
  return re ? new RegExp(re[1], re[2]) : entry
}

/**
 * Aggregate the safelist a block OWNS: a block that adds classes at runtime (built from a
 * variable in its island JS, so not visible in static HTML) drops a `css-safelist.json` next to
 * its files — a JSON array of class strings and/or "/regex/flags". The build auto-discovers and
 * merges them; no central list, no settings page. Themes can ship one at their package root.
 * @param {string} blocksDir absolute path to repo-root blocks/
 */
export async function loadBlockSafelist(blocksDir) {
  if (!existsSync(blocksDir)) return []
  const out = []
  for (const entry of await readdir(blocksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(blocksDir, entry.name, 'css-safelist.json')
    if (!existsSync(file)) continue
    try {
      const list = JSON.parse(await readFile(file, 'utf8'))
      if (Array.isArray(list)) out.push(...list.map(toMatcher).filter(Boolean))
    } catch {
      /* ignore a malformed block safelist — never fail the build over it */
    }
  }
  return out
}

/** Strip `<style>` blocks to a FIXED POINT (#323, CodeQL js/incomplete-multi-character-
 *  sanitization): a single-pass replace can CONSTRUCT a new `<style>` block from the text
 *  around a removed match (`<` + `<style>x</style>` + `style>…</style>` → `<style>…</style>`),
 *  leaving a live style body in the scanned content. Iterate until the input stops changing —
 *  each pass strictly shortens the string, so this terminates. */
function stripStyleBlocks(html) {
  let out = html
  let prev
  do {
    prev = out
    out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  } while (out !== prev)
  return out
}

/** Wrap purged CSS for inlining into the page. `</style` inside the CSS (legal in a string,
 *  e.g. `content:"</style>"`) would close the tag early and hand the rest of the CSS to the
 *  HTML parser — an element-injection vector (#323). Escape it as `<\/style` (an escaped `/`
 *  in a CSS string — byte-identical meaning; the sequence is invalid CSS anywhere else, so
 *  nothing correct is altered). Exported for unit tests. */
export function inlineStyleTag(css) {
  return `<style>${css.replace(/<\/(style)/gi, '<\\/$1')}</style>`
}

/** Purge `css` to only the rules used in `html` (+ optional island `js`), keeping `safelist`.
 *  `<style>` bodies are stripped from the scanned HTML so a rule's own selector text can't
 *  count as usage. Exported for unit tests.
 *  @param {{ css: string, html: string, js?: string[], safelist?: (string|RegExp)[] }} args */
export async function purgeCss({ css, html, js = [], safelist = [] }) {
  const scanHtml = stripStyleBlocks(html)
  const content = [
    { raw: scanHtml, extension: 'html' },
    ...js.map((raw) => ({ raw, extension: 'js' }))
  ]
  const [res] = await new PurgeCSS().purge({
    content,
    css: [{ raw: css }],
    safelist: { standard: safelist.map(toMatcher).filter(Boolean) }
    // Defaults keep @font-face + @keyframes; we only strip unused class rules.
  })
  return res.css
}

/** Collapse the build's island JS to its distinct selector tokens, joined into one string.
 *  PurgeCSS scans JS content with its default extractor (`/[A-Za-z0-9_-]+/g`), so running
 *  that extractor ONCE here and handing PurgeCSS the de-duplicated tokens yields exactly the
 *  same selector set as the raw sources — while each per-page purge call then scans a string
 *  bounded by the distinct tokens instead of every byte of emitted JS (#1119: the pass was
 *  O(pages × total JS bytes)). Lossless + bounded: apps/site/test/css-purge.test.ts
 *  ('jsSelectorContent — island JS scanned once, not per page'). Exported for unit tests.
 *  @param {string[]} jsSources */
export function jsSelectorContent(jsSources) {
  const tokens = new Set()
  for (const src of jsSources)
    for (const t of defaultOptions.defaultExtractor(src)) tokens.add(t)
  return [...tokens].join('\n')
}

/**
 * @typedef {{
 *   pages: number,
 *   inline: { blocks: number, before: number, after: number },
 *   inlinedSheets: { files: number, before: number, after: number },
 *   sharedSheets: { files: number, bytes: number }
 * }} PurgeStats
 */

/**
 * Per-page CSS purge over a built dist tree. What it does — and, deliberately, what it does
 * NOT do (#1119):
 *
 *   - PURGED per page: every inline `<style>` block (Astro inlines small stylesheets, which is
 *     where most per-block CSS lands) and every stylesheet `<link>`ed by exactly ONE page. Each
 *     is purged against THAT page's HTML + the build's island JS; a single-page stylesheet is
 *     then inlined and its file deleted (no render-blocking request for it).
 *   - NOT PURGED: any stylesheet linked by 2+ pages. It stays external, byte-for-byte, so the
 *     browser caches it once for the whole site. That includes Astro's combined theme + block
 *     bundle, which therefore still carries EVERY block's rules on every page that links it —
 *     a page with no hero still downloads `.blk-hero` from it. This is a chosen trade (one
 *     cached request beats re-shipping the theme base inline on every page), not an oversight;
 *     splitting theme base CSS (external, cached) from per-block CSS (emitted per page) is
 *     tracked as #1133.
 *
 * The returned stats keep the three kinds apart so the build log can claim a saving only for
 * CSS that was actually purged. Pinned by apps/site/test/css-purge.test.ts ('purgeDist +
 * formatPurgeReport — measures only what it purges') and, against the real build, by
 * apps/site/test/css-purge-build.test.ts.
 *
 * Safety: PurgeCSS keeps a rule when its class is present in the page HTML, so Astro's scoped
 * `[data-astro-cid-…]` rules for USED blocks survive and only UNUSED blocks are stripped. Classes
 * a block adds at runtime (built from a variable in island JS) won't appear in HTML — declare
 * those via `safelist` (block-local, aggregated by the build).
 *
 * @param {string} distRoot absolute path of the built output
 * @param {{ safelist?: (string|RegExp)[] }} [opts]
 * @returns {Promise<PurgeStats>}
 */
export async function purgeDist(distRoot, { safelist = [] } = {}) {
  const all = await walk(distRoot)
  const htmlFiles = all.filter((f) => f.endsWith('.html'))
  // Any class a runtime island references must survive — scan ALL emitted JS as content,
  // collapsed once for the whole build rather than re-scanned per page × stylesheet.
  const js = [
    jsSelectorContent(
      await Promise.all(
        all.filter((f) => f.endsWith('.js')).map((f) => readFile(f, 'utf8'))
      )
    )
  ]

  // Map each linked stylesheet → how many pages reference it. 2+ referrers = shared: left
  // external, cached and unpurged. Single-referrer files are purged + inlined.
  const refCount = new Map()
  const pages = []
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8')
    const links = [
      ...html.matchAll(
        /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+\.css)"[^>]*>/g
      )
    ]
    for (const m of links) refCount.set(m[1], (refCount.get(m[1]) ?? 0) + 1)
    pages.push({ file, html, links })
  }

  /** @type {PurgeStats} */
  const stats = {
    pages: pages.length,
    inline: { blocks: 0, before: 0, after: 0 },
    inlinedSheets: { files: 0, before: 0, after: 0 },
    sharedSheets: { files: 0, bytes: 0 }
  }
  const inlinedFiles = new Set()

  for (const { file, html, links } of pages) {
    // 1) Purge the original inline <style> blocks first (scan against `html`, not the
    //    mutated output, so the per-page links we inline below aren't re-processed).
    let out = await replaceAsync(
      html,
      /<style\b[^>]*>([\s\S]*?)<\/style>/g,
      async (whole, body) => {
        if (!body.trim()) return whole
        const purged = await purgeCss({ css: body, html, js, safelist })
        stats.inline.blocks += 1
        stats.inline.before += bytes(body)
        stats.inline.after += bytes(purged)
        return inlineStyleTag(purged)
      }
    )

    // 2) Purge each single-referrer external stylesheet → inline the result.
    for (const m of links) {
      const href = m[1]
      if ((refCount.get(href) ?? 0) >= 2) continue // shared — counted below, never purged
      const cssPath = join(distRoot, href.replace(/^\//, ''))
      const css = await readFile(cssPath, 'utf8').catch(() => null)
      if (css == null) continue
      const purged = await purgeCss({ css, html, js, safelist })
      stats.inlinedSheets.files += 1
      stats.inlinedSheets.before += bytes(css)
      stats.inlinedSheets.after += bytes(purged)
      out = out.replace(m[0], inlineStyleTag(purged))
      inlinedFiles.add(cssPath)
    }

    if (out !== html) await writeFile(file, out)
  }

  // The skipped shared stylesheets, measured once per FILE (each ships to every page that
  // links it, unpurged) — reported, never folded into the purged totals.
  for (const [href, count] of refCount) {
    if (count < 2) continue
    const size = await stat(join(distRoot, href.replace(/^\//, ''))).then(
      (s) => s.size,
      () => null
    )
    if (size == null) continue
    stats.sharedSheets.files += 1
    stats.sharedSheets.bytes += size
  }

  // Drop now-unreferenced per-page CSS files (their content is inlined into the one page).
  for (const f of inlinedFiles) await rm(f, { force: true })

  return stats
}

/** The build log line for a `purgeDist` run. The percentage is computed ONLY over CSS that
 *  was purged (inline blocks + single-page stylesheets); shared stylesheets are named with
 *  their size and an explicit "NOT purged", and when nothing was purged no percentage is
 *  printed at all (#1119 — the old line announced a saving for a bundle it had skipped).
 *  Pinned by apps/site/test/css-purge.test.ts. Exported for unit tests.
 *  @param {PurgeStats} s */
export function formatPurgeReport(s) {
  const before = s.inline.before + s.inlinedSheets.before
  const after = s.inline.after + s.inlinedSheets.after
  const parts = []
  if (before > 0) {
    const pct = Math.round((1 - after / before) * 100)
    parts.push(
      `purged ${kb(before)} → ${kb(after)} (-${pct}%) ` +
        `[${plural(s.inline.blocks, 'inline <style> block')}, ` +
        `${plural(s.inlinedSheets.files, 'single-page stylesheet')} inlined]`
    )
  } else {
    parts.push('nothing purged')
  }
  if (s.sharedSheets.files > 0)
    parts.push(
      `${plural(s.sharedSheets.files, 'shared stylesheet')} (${kb(s.sharedSheets.bytes)}) ` +
        'left external + cached, NOT purged — shipped whole to every page that links it'
    )
  return `per-page CSS purge across ${plural(s.pages, 'page')}: ${parts.join('; ')}`
}

/**
 * Astro integration: per-page CSS purge + inline at `astro:build:done` (dev is untouched).
 * What is and is not purged is documented on `purgeDist` above.
 *
 * @param {{ safelist?: (string|RegExp)[] }} [opts]
 */
export function perPageCssPurge(opts = {}) {
  return {
    name: 'setu:per-page-css-purge',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const blocksDir = fileURLToPath(
          new URL('../../../blocks', import.meta.url)
        )
        const safelist = [
          ...(opts.safelist ?? []),
          ...(await loadBlockSafelist(blocksDir))
        ]
        const stats = await purgeDist(fileURLToPath(dir), { safelist })
        logger.info(formatPurgeReport(stats))
      }
    }
  }
}

async function walk(root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

async function replaceAsync(str, regex, fn) {
  const parts = []
  let last = 0
  for (const m of str.matchAll(regex)) {
    parts.push(str.slice(last, m.index), await fn(...m))
    last = m.index + m[0].length
  }
  parts.push(str.slice(last))
  return parts.join('')
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`
const bytes = (str) => Buffer.byteLength(str, 'utf8')
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`
