import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PurgeCSS } from 'purgecss'

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

/**
 * Astro integration: per-page CSS purge + inline.
 *
 * Every Markdoc page's CSS bundle carries EVERY block's styles (the shared Markdoc config
 * statically imports all block components), so a callout-only page ships hero + button CSS
 * too. That's harmless today but grows linearly with the block count.
 *
 * After the build, for each page we:
 *   - purge its block CSS against THAT page's own HTML + all island JS, then inline the result
 *     and drop the now-dead external link (best first paint, no render-blocking request);
 *   - leave any stylesheet shared across pages (the cached fonts/theme file) untouched.
 *
 * Safety: PurgeCSS keeps a rule when its class is present in the page HTML, so Astro's scoped
 * `[data-astro-cid-…]` rules for USED blocks survive and only UNUSED blocks are stripped. Classes
 * a block adds at runtime (built from a variable in island JS) won't appear in HTML — declare
 * those via `safelist` (block-local, aggregated by the build).
 *
 * @param {{ safelist?: (string|RegExp)[] }} [opts]
 */
export function perPageCssPurge(opts = {}) {
  return {
    name: 'setu:per-page-css-purge',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const distRoot = fileURLToPath(dir)
        const blocksDir = fileURLToPath(
          new URL('../../../blocks', import.meta.url)
        )
        const safelist = [
          ...(opts.safelist ?? []),
          ...(await loadBlockSafelist(blocksDir))
        ]

        const all = await walk(distRoot)
        const htmlFiles = all.filter((f) => f.endsWith('.html'))
        // Any class a runtime island references must survive — scan ALL emitted JS as content.
        const js = await Promise.all(
          all.filter((f) => f.endsWith('.js')).map((f) => readFile(f, 'utf8'))
        )

        // Map each linked stylesheet → how many pages reference it. Files referenced by 2+ pages
        // are shared (fonts/theme); leave them external + cached. Single-referrer files are the
        // per-page block CSS we purge + inline.
        const refCount = new Map()
        const pages = []
        for (const file of htmlFiles) {
          const html = await readFile(file, 'utf8')
          const links = [
            ...html.matchAll(
              /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+\.css)"[^>]*>/g
            )
          ]
          for (const m of links)
            refCount.set(m[1], (refCount.get(m[1]) ?? 0) + 1)
          pages.push({ file, html, links })
        }

        let before = 0
        let after = 0
        const inlinedFiles = new Set()

        for (const { file, html, links } of pages) {
          // 1) Purge the original inline <style> blocks first (scan against `html`, not the
          //    mutated output, so the per-page links we inline below aren't re-processed).
          let out = await replaceAsync(
            html,
            /<style\b[^>]*>([\s\S]*?)<\/style>/g,
            async (whole, body) => {
              if (!body.trim()) return whole
              before += body.length
              const purged = await purgeCss({ css: body, html, js, safelist })
              after += purged.length
              return inlineStyleTag(purged)
            }
          )

          // 2) Purge each per-page (single-referrer) external stylesheet → inline the result.
          for (const m of links) {
            const href = m[1]
            if ((refCount.get(href) ?? 0) >= 2) continue // shared — keep external + cached
            const cssPath = join(distRoot, href.replace(/^\//, ''))
            const css = await readFile(cssPath, 'utf8').catch(() => null)
            if (css == null) continue
            before += css.length
            const purged = await purgeCss({ css, html, js, safelist })
            after += purged.length
            out = out.replace(m[0], inlineStyleTag(purged))
            inlinedFiles.add(cssPath)
          }

          if (out !== html) await writeFile(file, out)
        }

        // Drop now-unreferenced per-page CSS files (their content is inlined into the one page).
        for (const f of inlinedFiles) await rm(f, { force: true })

        const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0
        logger.info(
          `per-page CSS purge: ${kb(before)} → ${kb(after)} (-${pct}%) inlined across ${pages.length} pages`
        )
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
