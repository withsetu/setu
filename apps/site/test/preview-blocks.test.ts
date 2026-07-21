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

/**
 * The SAME crash class, but for markdoc *nodes* (heading/paragraph/th/td/image) rather than
 * {% tag %} blocks. preview.astro carries a separate `nodeComponentMap`, and markdoc.config.mjs
 * renders each node via `render: component(...)`. A node renderer added to the config but
 * forgotten in the preview map leaks the `component()` descriptor into @astrojs/react and
 * crashes the preview with the same cryptic "…(reading 'toString')" — with, until now, no
 * failing test (the tag side had two derivation guards; the node side had zero).
 *
 * This derives the required node set from the config's source of truth — every `nodes.<name>`
 * entry that carries a `render: component(...)` (so `item`, which only has a `transform`, is
 * correctly excluded) — and asserts the preview `nodeComponentMap` covers each one.
 */
const configSrc = readFileSync(`${here}/../markdoc.config.mjs`, 'utf8')
// Isolate the top-level `nodes: { … }` object (its close is the only `\n  }` at 2-space indent).
const nodesBlock =
  configSrc.match(/\n {2}nodes: \{([\s\S]*?)\n {2}\}/)?.[1] ?? ''
// Each node entry is a key at 4-space indent; slice between consecutive keys to get its body,
// then keep only nodes whose body carries a `render: component(...)`.
const nodeStarts = [...nodesBlock.matchAll(/^ {4}([\w-]+): \{/gm)]
const renderedNodes = nodeStarts
  .filter((m, i) => {
    const start = m.index ?? 0
    const end = nodeStarts[i + 1]?.index ?? nodesBlock.length
    return /render:\s*component\(/.test(nodesBlock.slice(start, end))
  })
  .map((m) => m[1])

const nodeMapBody =
  previewSrc.match(/const nodeComponentMap = \{([\s\S]*?)\}/)?.[1] ?? ''
const registeredNodes = new Set(
  [...nodeMapBody.matchAll(/(?:'([\w-]+)'|(\w+)):/g)].map((m) => m[1] ?? m[2])
)

describe('preview registers a renderer for every markdoc node', () => {
  it('found rendered nodes and a non-empty preview nodeComponentMap', () => {
    expect(renderedNodes.length).toBeGreaterThan(0)
    expect(registeredNodes.size).toBeGreaterThan(0)
  })

  for (const node of renderedNodes) {
    it(`node "${node}" is registered in the preview nodeComponentMap`, () => {
      expect(registeredNodes.has(node)).toBe(true)
    })
  }
})
