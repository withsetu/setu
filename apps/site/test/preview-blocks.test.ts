import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STANDARD_BLOCKS } from '@setu/core'

/**
 * Regression guard for the "undefined component in preview" crash class.
 *
 * The in-editor preview (apps/site/src/preview/preview.astro) resolves each markdoc block
 * tag through an explicit `tagComponentMap`. A block that exists but is MISSING from that map
 * renders as `undefined`, which @astrojs/react then crashes on with a cryptic
 * "Cannot read properties of undefined (reading 'toString')".
 *
 * This test derives the full block set from the committed sources of truth — the core
 * STANDARD_BLOCKS (hero, button) and the auto-discovered repo-root `blocks/` folders — and
 * asserts the preview registers a renderer for every one. Add a block, forget the preview
 * map, and this fails by name instead of crashing a user mid-UAT.
 */
const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

const folderBlocks = readdirSync(`${repoRoot}/blocks`, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

const blockTags = [...STANDARD_BLOCKS.map((b) => b.tag), ...folderBlocks].sort()

const previewSrc = readFileSync(`${here}/../src/preview/preview.astro`, 'utf8')
const mapBody =
  previewSrc.match(/const tagComponentMap = \{([\s\S]*?)\n\}/)?.[1] ?? ''
// Keys are bare identifiers (callout:) or quoted for hyphenated tags ('latest-posts':).
const registered = new Set(
  [...mapBody.matchAll(/(?:'([\w-]+)'|(\w+)):/g)].map((m) => m[1] ?? m[2])
)

describe('preview registers a renderer for every block', () => {
  it('found block tags and a non-empty preview map', () => {
    expect(blockTags.length).toBeGreaterThan(0)
    expect(registered.size).toBeGreaterThan(0)
  })

  for (const tag of blockTags) {
    it(`{% ${tag} %} is registered in the preview tagComponentMap`, () => {
      expect(registered.has(tag)).toBe(true)
    })
  }
})
