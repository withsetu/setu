import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ATOM_TAG_TO_NODE, ATOM_NODE_TO_TAG } from '@setu/core'
import {
  EDITOR_BLOCKS,
  buildBlockExtensions,
  INSPECTABLE_NODES,
  tagForNode,
  insertPayloadForTag,
  hasSlashInsert,
  SETU_BLOCK_NODE
} from '../src/editor/block-registry'
import { attrString } from '../src/editor/attr-string'

/**
 * Derivation guard for the "registered-but-not-wired" (and "wired-but-not-registered")
 * omission class — the editor-side analogue of the preview-blocks guard
 * (apps/site/test/preview-blocks.test.ts), extended to every editor site.
 *
 * Registering an atom block used to touch four hand-kept editor lists that nothing checked
 * were in sync: the Canvas extensions array, the blocks.ts slash-insert chain, and
 * useSelectedBlock's INSPECTABLE Set AND its parallel `tagOf` ternary. A block could
 * serialize (the converters read the core ATOM_TAG_TO_NODE map) yet be silently
 * un-selectable / un-inspectable, with a green build (CLAUDE.md §4 #14's class).
 *
 * #563 collapsed all four into ONE registry (block-registry.ts) that every site derives
 * from. This test asserts the registry stays complete against the converters' source of
 * truth (ATOM_TAG_TO_NODE) AND that every derived site actually contains each atom — so a
 * future atom added to the core map but forgotten in the registry, or a registry entry
 * dropped from a derivation, turns RED by name instead of shipping the silent bug.
 */

// The build-time Canvas extensions the registry materialises (ctx values are irrelevant to
// node identity — empty is fine for the generic setuBlock fallback).
const extensionNames = buildBlockExtensions({
  blocks: [],
  blockCores: {}
}).map((e) => e.name)

// The preview renderer map, parsed from apps/site's preview.astro exactly as the site-side
// guard does — so this one test asserts presence across the editor sites AND the preview.
const previewSrc = readFileSync(
  resolve(__dirname, '../../site/src/preview/preview.astro'),
  'utf8'
)
const previewMapBody =
  previewSrc.match(/const tagComponentMap = \{([\s\S]*?)\n\}/)?.[1] ?? ''
const previewTags = new Set(
  [...previewMapBody.matchAll(/(?:'([\w-]+)'|(\w+)):/g)].map(
    (m) => m[1] ?? m[2]
  )
)

const atomTags = Object.keys(ATOM_TAG_TO_NODE)

describe('editor block registry — sanity', () => {
  it('found the atom source of truth, the preview map, and the built extensions', () => {
    expect(atomTags.length).toBeGreaterThan(0)
    expect(previewTags.size).toBeGreaterThan(0)
    expect(extensionNames.length).toBeGreaterThan(0)
  })
})

describe('every atom in the core ATOM_TAG_TO_NODE map is registered + wired into every editor site', () => {
  for (const tag of atomTags) {
    const node = ATOM_TAG_TO_NODE[tag]!

    describe(`{% ${tag} %} (${node})`, () => {
      const def = EDITOR_BLOCKS.find((d) => d.tag === tag)

      it('has a registry entry whose node matches the core map (registered)', () => {
        expect(def).toBeDefined()
        expect(def!.node).toBe(node)
      })

      it('is in the Canvas extensions array (wired: Canvas)', () => {
        expect(extensionNames).toContain(node)
      })

      it('maps back to its tag via tagForNode (wired: useSelectedBlock tagOf)', () => {
        expect(tagForNode(node, {}, attrString)).toBe(tag)
      })

      it('INSPECTABLE membership matches its `inspectable` flag (wired: INSPECTABLE)', () => {
        expect(INSPECTABLE_NODES.has(node)).toBe(def!.inspectable)
      })

      it('slash-insert payload targets its node, or is intentionally paste-only (wired: slash)', () => {
        if (hasSlashInsert(tag)) {
          expect(insertPayloadForTag(tag).type).toBe(node)
        } else {
          // The only paste-driven atom is `embed` (EmbedPaste resolves a URL → node).
          expect(tag).toBe('embed')
        }
      })

      it('has a renderer in the preview tagComponentMap (wired: preview)', () => {
        expect(previewTags.has(tag)).toBe(true)
      })
    })
  }
})

describe('registry ↔ core bijection (wired-but-not-registered guard)', () => {
  it('every fixed-tag registry node round-trips through the core atom map where it is one', () => {
    for (const def of EDITOR_BLOCKS) {
      if (def.tag && def.node in ATOM_NODE_TO_TAG) {
        expect(ATOM_NODE_TO_TAG[def.node]).toBe(def.tag)
      }
    }
  })
})

describe('behaviour preservation — the derived sites equal the historical hand-kept lists', () => {
  it('INSPECTABLE is exactly the pre-#563 set', () => {
    expect(new Set(INSPECTABLE_NODES)).toEqual(
      new Set([
        SETU_BLOCK_NODE,
        'heroBlock',
        'galleryBlock',
        'videoBlock',
        'queryBlock',
        'spacerBlock',
        'columns',
        'latestPostsBlock'
      ])
    )
  })

  it('the Canvas block extensions are exactly the pre-#563 set, in order', () => {
    expect(extensionNames).toEqual([
      'callout',
      'columns',
      'column',
      'contactBlock',
      'heroBlock',
      'galleryBlock',
      'spacerBlock',
      'videoBlock',
      'queryBlock',
      'latestPostsBlock',
      'embedBlock',
      SETU_BLOCK_NODE
    ])
  })

  it('the generic setuBlock fallback keeps its dynamic tag (from attrs.tag)', () => {
    expect(tagForNode(SETU_BLOCK_NODE, { tag: 'notice' }, attrString)).toBe(
      'notice'
    )
    // A folder block with no dedicated node inserts as the setuBlock fallback.
    const payload = insertPayloadForTag('notice')
    expect(payload.type).toBe(SETU_BLOCK_NODE)
    expect((payload.attrs as { tag: string }).tag).toBe('notice')
  })
})
