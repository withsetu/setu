import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  STANDARD_BLOCKS,
  markdocAttributesFor,
  mergeBlockSources
} from '@setu/core'
import type { BlockEntry } from '@setu/core'
import { loadEntries } from '../../../scripts/gen-blocks.mjs'

// #1249 — a block whose contract offers a Wide / Full width only works on the site if a
// breakout rule moves it out of the reading measure (docs/block-styling-contract.md: since
// #1296 those rules live in the shared @setu/blocks/base.css a theme loads first, never in a
// block's own CSS). Nothing tied the two
// together: the embed shipped `align: none|wide|full` for months with no theme rule at all,
// while the only test of this class covered `section`.
//
// So this is table-driven off the block CONTRACTS (core STANDARD_BLOCKS + the repo-root
// blocks/ folders, loaded the same way scripts/gen-blocks.mjs loads them): every prop whose
// enum offers both `wide` and `full` must have, in the BUILT CSS, a wide rule that sizes to
// the page measure and a full rule that bleeds 100vw. A new block that declares the enum
// without the breakout rules fails here by name.
//
// Class vocabulary: renderers mark the width as `.blk-<tag>.w-<value>` (hero, gallery,
// video, section) or `.blk-<tag>.align-<value>` (embed — the image's `align-*` naming).
// Either is accepted; what is checked is that one of them is styled.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')

/** A marker from the newest fixture this suite's sibling suites rely on; a dist built
 *  before it existed is stale, so rebuild rather than read old CSS. */
const MARKER = 'Fragment no-query facade 1249'

const files = (dir: string, ext: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p, ext)
    return name.endsWith(ext) ? [p] : []
  })

let css = ''
let widthBlocks: Array<{ tag: string; prop: string }> = []

beforeAll(async () => {
  const demo = join(distDir, 'page', 'embed-demo', 'index.html')
  if (!existsSync(demo) || !readFileSync(demo, 'utf8').includes(MARKER))
    execSync('pnpm build', { cwd: appDir, stdio: 'inherit' })

  // Every stylesheet the build ships: external sheets plus every page's inline <style>.
  const inline = files(distDir, '.html').flatMap((f) =>
    [
      ...readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)
    ].map((m) => m[1])
  )
  css = [
    ...files(distDir, '.css').map((f) => readFileSync(f, 'utf8')),
    ...inline
  ].join('\n')

  // gen-blocks.mjs is untyped JS: its jiti-imported contracts come back as `unknown`.
  const local = (await loadEntries()) as BlockEntry[]
  const entries = mergeBlockSources({ standard: STANDARD_BLOCKS, local })
  widthBlocks = entries.flatMap(({ tag, contract }) =>
    Object.entries(markdocAttributesFor(contract.props))
      .filter(
        ([, a]) => a.matches?.includes('wide') && a.matches.includes('full')
      )
      .map(([prop]) => ({ tag, prop }))
  )
}, 180_000)

/** Every declaration block whose selector list names `.blk-<tag>.<w|align>-<value>`. */
const rulesFor = (tag: string, value: string): string[] => {
  const sel = new RegExp(`\\.blk-${tag}\\.(?:w|align)-${value}(?![\\w-])`)
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => sel.test(m[1]))
    .map((m) => m[2])
}

describe('wide / full breakout — every block that offers it is styled in the built site (#1249)', () => {
  it('found the width-capable blocks from the contracts (anti-vacuity)', () => {
    const tags = widthBlocks.map((b) => b.tag)
    // The ones known today — derived, not hard-coded; this only proves discovery works.
    for (const t of ['hero', 'gallery', 'video', 'section', 'embed'])
      expect(tags).toContain(t)
  })

  it('every one has a wide rule at the page measure and a full rule that bleeds 100vw', () => {
    const missing: string[] = []
    for (const { tag, prop } of widthBlocks) {
      const wide = rulesFor(tag, 'wide')
      const full = rulesFor(tag, 'full')
      if (!wide.some((d) => d.includes('var(--measure-page)')))
        missing.push(
          `${tag}.${prop}=wide: no rule sizing to var(--measure-page)`
        )
      if (!full.some((d) => d.includes('100vw')))
        missing.push(`${tag}.${prop}=full: no rule bleeding to 100vw`)
    }
    expect(missing).toEqual([])
  })
})
