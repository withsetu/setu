import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// The integration is plain ESM; import its exported pure helpers.
import {
  purgeCss,
  loadBlockSafelist,
  inlineStyleTag
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
