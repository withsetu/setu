import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// The integration is plain ESM; import its exported pure helpers.
import {
  purgeCss,
  loadBlockSafelist,
  inlineStyleTag,
  jsSelectorContent,
  purgeDist,
  formatPurgeReport
} from '../integrations/per-page-css-purge.mjs'

const CSS =
  '.blk-callout{color:red}.blk-hero{color:blue}.is-live{display:block}'

describe('per-page CSS purge', () => {
  it('keeps CSS for blocks present in the page HTML', async () => {
    const out = await purgeCss({
      css: CSS,
      html: '<div class="blk-callout">hi</div>'
    })
    expect(out).toContain('.blk-callout')
  })

  it('strips CSS for blocks the page does not use', async () => {
    const out = await purgeCss({
      css: CSS,
      html: '<div class="blk-callout">hi</div>'
    })
    expect(out).not.toContain('.blk-hero')
  })

  it('does not let a rule validate itself via an inline <style> in the HTML', async () => {
    // .blk-hero appears only inside a <style> block, not on any element → must still be stripped.
    const html =
      '<style>.blk-hero{color:blue}</style><div class="blk-callout">hi</div>'
    const out = await purgeCss({ css: CSS, html })
    expect(out).not.toContain('.blk-hero')
  })

  it('keeps a class referenced as a literal in island JS', async () => {
    const out = await purgeCss({
      css: CSS,
      html: '<div></div>',
      js: ['el.classList.add("is-live")']
    })
    expect(out).toContain('.is-live')
  })

  it('honors a safelist (string + /regex/) for runtime-built classes', async () => {
    const css = '.tone-amber{x:1}.tone-rose{x:2}.kept{y:1}'
    const out = await purgeCss({
      css,
      html: '<div></div>',
      safelist: ['kept', '/^tone-/']
    })
    expect(out).toContain('.tone-amber')
    expect(out).toContain('.tone-rose')
    expect(out).toContain('.kept')
  })

  // #323 (CodeQL js/incomplete-multi-character-sanitization): a SINGLE-pass
  // `replace(/<style…<\/style>/g, '')` can CONSTRUCT a new <style> block out of the text
  // surrounding a removed match — `<` + `<style>x</style>` + `style>…</style>` collapses to
  // `<style>…</style>` after one pass, so the leftover style BODY is scanned as page content
  // and its selector text keeps rules alive that nothing on the page uses. The strip must
  // iterate to a fixed point.
  it('strips overlap-constructed <style> blocks — one removal must not mint a new one (#323)', async () => {
    const html =
      '<' +
      '<style>x</style>' +
      'style>.blk-hero{color:blue}</style>' +
      '<div class="blk-callout">hi</div>'
    const out = await purgeCss({ css: CSS, html })
    expect(out).not.toContain('.blk-hero')
  })

  it('survives a doubly-nested construction (fixed point, not just two passes) (#323)', async () => {
    // Two levels of the same trick: each pass removes one layer and mints the next.
    const inner = '<' + '<style>x</style>' + 'style>y</style>'
    const html =
      '<' +
      inner +
      'style>.blk-hero{color:blue}</style>' +
      '<div class="blk-callout">hi</div>'
    const out = await purgeCss({ css: CSS, html })
    expect(out).not.toContain('.blk-hero')
  })
})

describe('inlineStyleTag — the purged-CSS inlining boundary (#323)', () => {
  it('wraps CSS in a <style> tag', () => {
    expect(inlineStyleTag('.a{x:1}')).toBe('<style>.a{x:1}</style>')
  })

  it('cannot be broken out of by a `</style` sequence in the CSS', () => {
    // CSS can legally contain `</style>` inside a string (e.g. content:"</style>").
    // Inlined raw, that closes the tag early and everything after is parsed as HTML —
    // an element-injection vector. The escape (`<\/` — an escaped `/` in a CSS string,
    // byte-identical meaning) must leave NO literal `</style` in the emitted tag body.
    const out = inlineStyleTag('.a::before{content:"</style><img src=x>"}')
    const body = out.slice('<style>'.length, -'</style>'.length)
    expect(body).not.toMatch(/<\/style/i)
    expect(out.endsWith('</style>')).toBe(true)
    // And the escape must preserve the CSS meaning: `<\/style>` decodes to `</style>`.
    expect(body).toContain('<\\/style>')
  })

  it('escapes case variants too (</STYLE, </Style)', () => {
    const out = inlineStyleTag('.a::before{content:"</STYLE><script>"}')
    const body = out.slice('<style>'.length, -'</style>'.length)
    expect(body).not.toMatch(/<\/style/i)
  })
})

describe('block-local safelist discovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blocks-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('aggregates css-safelist.json from each block folder', async () => {
    mkdirSync(join(dir, 'fancy'))
    writeFileSync(
      join(dir, 'fancy', 'css-safelist.json'),
      JSON.stringify(['is-active', '/^anim-/'])
    )
    mkdirSync(join(dir, 'plain')) // no safelist file → contributes nothing
    const list = await loadBlockSafelist(dir)
    expect(list).toContain('is-active')
    expect(list.some((m) => m instanceof RegExp && m.test('anim-fade'))).toBe(
      true
    )
  })

  it('returns [] for a missing blocks dir and ignores malformed json', async () => {
    expect(await loadBlockSafelist(join(dir, 'nope'))).toEqual([])
    mkdirSync(join(dir, 'broken'))
    writeFileSync(join(dir, 'broken', 'css-safelist.json'), '{ not valid')
    expect(Array.isArray(await loadBlockSafelist(dir))).toBe(true)
  })
})

// #1119 — the island JS is scanned as PurgeCSS content for every page × stylesheet. Handing
// PurgeCSS every emitted .js file's full text on each of those calls made the pass
// O(pages × total JS bytes). `jsSelectorContent` collapses the JS to its unique selector
// tokens ONCE per build; these pin that the collapse is lossless and actually bounded.
describe('jsSelectorContent — island JS scanned once, not per page (#1119)', () => {
  const ISLAND =
    'el.classList.add("is-live");const t=`tone-${x}`;q(".blk-callout")'

  it('purges identically to the raw JS it replaces', async () => {
    const css = `${CSS}.tone-{a:1}.never-used{b:2}`
    const html = '<div></div>'
    const raw = await purgeCss({ css, html, js: [ISLAND, 'other()'] })
    const collapsed = await purgeCss({
      css,
      html,
      js: [jsSelectorContent([ISLAND, 'other()'])]
    })
    expect(collapsed).toBe(raw)
    expect(collapsed).toContain('.is-live')
    expect(collapsed).toContain('.blk-callout')
    expect(collapsed).not.toContain('.never-used')
  })

  it('is bounded by the distinct tokens, not by the bytes of JS', () => {
    const once = jsSelectorContent([ISLAND])
    const many = jsSelectorContent(Array.from({ length: 500 }, () => ISLAND))
    expect(many).toBe(once)
  })
})

// #1119 — what the pass does to a real dist tree, and what it REPORTS. The shared stylesheet
// (linked from 2+ pages) is deliberately left external and cached, unpurged; the report must
// say so and must not count it toward the saving it announces.
describe('purgeDist + formatPurgeReport — measures only what it purges (#1119)', () => {
  const root = mkdtempSync(join(tmpdir(), 'purge-dist-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const SHARED =
    '.blk-callout{color:red}.blk-hero{color:blue}.blk-gallery{gap:1px}'
  const SOLO = '.blk-callout{x:1}.blk-video{y:2}'
  const INLINE = '.blk-callout{a:1}.blk-section{b:2}'
  const pageHtml = (extraLink = '') =>
    `<html><head><link rel="stylesheet" href="/_astro/shared.css">${extraLink}` +
    `<style>${INLINE}</style></head><body><div class="blk-callout">hi</div></body></html>`

  let stats: Awaited<ReturnType<typeof purgeDist>>
  beforeAll(async () => {
    mkdirSync(join(root, '_astro'))
    mkdirSync(join(root, 'a'))
    mkdirSync(join(root, 'b'))
    writeFileSync(join(root, '_astro', 'shared.css'), SHARED)
    writeFileSync(join(root, '_astro', 'solo.css'), SOLO)
    writeFileSync(
      join(root, 'a', 'index.html'),
      pageHtml('<link rel="stylesheet" href="/_astro/solo.css">')
    )
    writeFileSync(join(root, 'b', 'index.html'), pageHtml())
    stats = await purgeDist(root)
  })

  it('leaves the shared stylesheet on disk, unpurged, and still linked from every page', () => {
    expect(readFileSync(join(root, '_astro', 'shared.css'), 'utf8')).toBe(
      SHARED
    )
    for (const p of ['a', 'b'])
      expect(readFileSync(join(root, p, 'index.html'), 'utf8')).toContain(
        '<link rel="stylesheet" href="/_astro/shared.css">'
      )
  })

  it('purges + inlines the single-page stylesheet and deletes the file', () => {
    const a = readFileSync(join(root, 'a', 'index.html'), 'utf8')
    expect(a).not.toContain('solo.css')
    expect(a).toContain('.blk-callout{x:1}')
    expect(a).not.toContain('.blk-video')
    expect(existsSync(join(root, '_astro', 'solo.css'))).toBe(false)
  })

  it('counts each kind separately — the shared bytes never enter the purged totals', () => {
    expect(stats.pages).toBe(2)
    expect(stats.inline.blocks).toBe(2)
    expect(stats.inline.before).toBe(2 * INLINE.length)
    expect(stats.inline.after).toBe(2 * '.blk-callout{a:1}'.length)
    expect(stats.inlinedSheets).toEqual({
      files: 1,
      before: SOLO.length,
      after: '.blk-callout{x:1}'.length
    })
    expect(stats.sharedSheets).toEqual({ files: 1, bytes: SHARED.length })
  })

  it('reports the saving over purged CSS only, and names the shared bundle it skipped', () => {
    const report = formatPurgeReport(stats)
    const purgedBefore = stats.inline.before + stats.inlinedSheets.before
    const purgedAfter = stats.inline.after + stats.inlinedSheets.after
    const pct = Math.round((1 - purgedAfter / purgedBefore) * 100)
    expect(report).toContain(`(-${pct}%)`)
    expect(report).toMatch(
      /1 shared stylesheet \(0\.1 kB\) left external \+ cached, NOT purged/
    )
    expect(report).toContain('2 pages')
  })

  it('never reports a saving when the shared bundle is the only CSS', () => {
    const report = formatPurgeReport({
      pages: 24,
      inline: { blocks: 0, before: 0, after: 0 },
      inlinedSheets: { files: 0, before: 0, after: 0 },
      sharedSheets: { files: 1, bytes: 14_810 }
    })
    expect(report).not.toMatch(/-\d+%/)
    expect(report).toContain('nothing purged')
    expect(report).toContain(
      '1 shared stylesheet (14.5 kB) left external + cached, NOT purged'
    )
  })
})
