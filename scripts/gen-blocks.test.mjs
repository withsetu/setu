// #820: a block folder name is the block's TAG, and it flows into generated JavaScript that
// apps/site imports at build time — an execution sink, reached with no human in the loop on every
// `pnpm dev` (gen-blocks is the site's predev/prebuild). These tests pin the folder-name guard.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { assertValidTag, loadEntries } from './gen-blocks.mjs'

/** A minimal block folder: `<dir>/<tag>/block.ts` + `<tag>.astro`. The contract is imported via
 *  jiti, so it only has to be valid TS with a default export. */
function makeBlocksDir(tags) {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-blocks-'))
  for (const tag of tags) {
    const folder = path.join(dir, tag)
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      path.join(folder, 'block.ts'),
      `export default { tag: ${JSON.stringify(tag)} }\n`
    )
    writeFileSync(path.join(folder, `${tag}.astro`), '<div />\n')
  }
  return dir
}

test('loadEntries discovers a well-named block folder', async () => {
  const dir = makeBlocksDir(['pricing-table'])
  try {
    const entries = await loadEntries(dir)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].tag, 'pricing-table')
    assert.equal(
      entries[0].component,
      'blocks/pricing-table/pricing-table.astro'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// KILL-SHOT TABLE: each of these reaches `component('blocks/<tag>/<tag>.astro')` in emitted JS.
// The quote/backslash cases break out of the single-quoted literal the consumer builds; the
// traversal cases point the import specifier outside the blocks tree. Remove the regex check in
// loadEntries and every one of these stops throwing.
//
// Asserted against the validator directly because some of them cannot exist as a readdir entry —
// `..` is not a name a directory can have — so a fixture-only table would silently skip the case
// that matters most. The loadEntries end-to-end refusals below cover the wiring.
const BAD_TAGS = [
  "quote'injection",
  'back\\slash',
  '..',
  '../escape',
  './x',
  'Upper',
  '1leading-digit',
  '-leading-dash',
  'trailing_underscore',
  'with space',
  ''
]

for (const tag of BAD_TAGS) {
  test(`assertValidTag refuses ${JSON.stringify(tag)}`, () => {
    assert.throws(
      () => assertValidTag(tag),
      (err) => {
        assert.match(err.message, /block folder/i)
        assert.ok(
          err.message.includes(JSON.stringify(tag)),
          `error names the offending folder: ${err.message}`
        )
        return true
      }
    )
  })
}

test('assertValidTag accepts ordinary block tags', () => {
  for (const ok of ['hero', 'pricing-table', 'gallery2', 'a'])
    assert.equal(assertValidTag(ok), ok)
})

// End-to-end: the guard is actually wired into the discovery loop, not just exported next to it.
for (const tag of ["quote'injection", 'Upper', 'with space']) {
  test(`loadEntries refuses the block folder ${JSON.stringify(tag)}`, async () => {
    const dir = makeBlocksDir([tag])
    try {
      await assert.rejects(() => loadEntries(dir), /invalid block folder/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('a directory without block.ts is skipped, not rejected', async () => {
  // Editor cruft and stray folders must not fail the build — only real block folders are validated.
  const dir = makeBlocksDir(['hero'])
  mkdirSync(path.join(dir, '.DS_Store_dir'), { recursive: true })
  mkdirSync(path.join(dir, 'Not A Block'), { recursive: true })
  try {
    const entries = await loadEntries(dir)
    assert.deepEqual(
      entries.map((e) => e.tag),
      ['hero']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a valid block folder missing its .astro still errors', async () => {
  const dir = makeBlocksDir(['hero'])
  rmSync(path.join(dir, 'hero', 'hero.astro'))
  try {
    await assert.rejects(() => loadEntries(dir), /missing hero\.astro/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
