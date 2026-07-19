// ---------------------------------------------------------------------------------
// THE single editor block registry (#563 — closes the #561→#562→#563 DX refactor).
//
// Registering one block used to touch ~12 scattered, hand-kept sites, four of them on
// the editor side each re-listing "this block exists": the Canvas extensions array, the
// blocks.ts slash-insert `else if` chain, and useSelectedBlock's INSPECTABLE Set AND its
// parallel `tagOf` ternary. Nothing derived one from another and nothing checked they
// stayed in sync — a block could serialize (the converters read the core ATOM_TAG_TO_NODE
// map) yet silently be un-selectable and un-inspectable, with a green build (CLAUDE.md
// §4 #14's class).
//
// This table is now the ONE authored side. Each block declares its identity + editor wiring
// ONCE; every editor site is DERIVED from it:
//   - Canvas extensions  → `buildBlockExtensions(ctx)`   (was: hand-listed imports + array)
//   - slash insert        → `insertPayloadForTag`         (was: the else-if chain)
//   - INSPECTABLE set     → `INSPECTABLE_NODES`           (was: a hardcoded Set)
//   - tagOf(node)         → `tagForNode`                  (was: a parallel ternary chain)
// The derivation guard (apps/admin/test/block-registry.test.ts) then asserts every atom in
// the core ATOM_TAG_TO_NODE map is present here and wired into each derived site, turning a
// registered-but-not-wired (or wired-but-not-registered) block into a RED test.
// ---------------------------------------------------------------------------------
import type { Extensions, JSONContent } from '@tiptap/core'
import type { ResolvedBlock } from '@setu/core'
import type { BlockCore } from '@setu/blocks'
import type { RunQuery } from './QueryPreview'
import {
  ensureFormId,
  DEFAULT_SUCCESS_MESSAGE
} from './extensions/contact-helpers'
import { Callout } from './extensions/Callout'
import { Columns, Column } from './extensions/Columns'
import { ContactBlock } from './extensions/ContactBlock'
import { HeroBlock } from './extensions/HeroBlock'
import { GalleryBlock } from './extensions/GalleryBlock'
import { SpacerBlock } from './extensions/SpacerBlock'
import { VideoBlock } from './extensions/VideoBlock'
import { QueryBlock } from './extensions/QueryBlock'
import { LatestPostsBlock } from './extensions/LatestPostsBlock'
import { EmbedBlock } from './extensions/EmbedBlock'
import { createSetuBlock } from './extensions/SetuBlock'

/** The generic fallback node type: any folder block WITHOUT a dedicated editor node
 *  (notice, related, section, button, …) inserts as a `setuBlock` carrying its tag. Its
 *  editor tag is dynamic (from `attrs.tag`), so it is not keyed by a single Markdoc tag. */
export const SETU_BLOCK_NODE = 'setuBlock'

/** What the Canvas passes when materialising each block's Tiptap extension(s): the live
 *  `runQuery` (bound into query/latest-posts), and the resolved block set + cores the
 *  generic `setuBlock` fallback renders folder blocks from. */
export interface BlockExtensionCtx {
  runQuery?: RunQuery
  blocks: ResolvedBlock[]
  blockCores: Record<string, BlockCore>
}

export interface EditorBlockDef {
  /** Markdoc tag, e.g. `hero`. Omitted for the generic `setuBlock` fallback (dynamic tag). */
  tag?: string
  /** Tiptap node name, e.g. `heroBlock`. */
  node: string
  /** True when the block's props are edited in the inspector rail — drives INSPECTABLE.
   *  callout/contact/embed keep their own bespoke in-canvas UI and are NOT inspector-driven. */
  inspectable: boolean
  /** Materialise the Tiptap extension(s) this block contributes to the editor. A builder
   *  (not a value) so query/latest-posts bind the live `runQuery`, columns adds its `Column`
   *  child, and setuBlock is built from the resolved block set. */
  extensions: (ctx: BlockExtensionCtx) => Extensions
  /** Build the slash-menu insert payload for a fresh block. Omitted for blocks that are not
   *  cold slash-insertable (embed = paste-driven). A builder because a fresh insert may need
   *  a freshly-minted value (contact's stable formId). */
  slashInsert?: () => JSONContent
}

/** One empty column: a `column` node seeded with an empty paragraph (`column` requires
 *  `block+`). Built fresh per insert so the two columns never share an object reference. */
const emptyColumn = (): JSONContent => ({
  type: 'column',
  content: [{ type: 'paragraph' }]
})

/**
 * THE registry. Order matches the historical Canvas extensions array so the built editor
 * schema is byte-identical to before this refactor.
 */
export const EDITOR_BLOCKS: EditorBlockDef[] = [
  {
    tag: 'callout',
    node: 'callout',
    inspectable: false,
    extensions: () => [Callout],
    slashInsert: () => ({
      type: 'callout',
      attrs: { mdAttrs: { type: 'info' } },
      content: [{ type: 'paragraph' }]
    })
  },
  {
    tag: 'columns',
    node: 'columns',
    inspectable: true,
    extensions: () => [Columns, Column],
    slashInsert: () => ({
      type: 'columns',
      attrs: { mdAttrs: { layout: '50-50' } },
      content: [emptyColumn(), emptyColumn()]
    })
  },
  {
    tag: 'contact',
    node: 'contactBlock',
    inspectable: false,
    extensions: () => [ContactBlock],
    slashInsert: () => ({
      type: 'contactBlock',
      attrs: {
        mdAttrs: ensureFormId({
          formLabel: 'Contact',
          subject: false,
          nameRequired: true,
          subjectRequired: false,
          messageRequired: true,
          successMessage: DEFAULT_SUCCESS_MESSAGE
        })
      }
    })
  },
  {
    tag: 'hero',
    node: 'heroBlock',
    inspectable: true,
    extensions: () => [HeroBlock],
    slashInsert: () => ({
      type: 'heroBlock',
      attrs: { mdAttrs: { headline: 'Hero headline', layout: 'centered' } }
    })
  },
  {
    tag: 'gallery',
    node: 'galleryBlock',
    inspectable: true,
    extensions: () => [GalleryBlock],
    // Fresh gallery starts empty: the canvas shows an inviting empty state and the
    // inspector's media-list control appends images from the library.
    slashInsert: () => ({ type: 'galleryBlock', attrs: { mdAttrs: {} } })
  },
  {
    tag: 'spacer',
    node: 'spacerBlock',
    inspectable: true,
    extensions: () => [SpacerBlock],
    // Attribute-free insert: the canvas/renderer apply the contract default (48px) and
    // the serialized form stays a clean `{% spacer /%}`.
    slashInsert: () => ({ type: 'spacerBlock', attrs: { mdAttrs: {} } })
  },
  {
    tag: 'video',
    node: 'videoBlock',
    inspectable: true,
    extensions: () => [VideoBlock],
    // Empty mdAttrs → the atom renders its inviting placeholder; the author picks the
    // file via the inspector's media control (contract defaults cover controls/loop/…).
    slashInsert: () => ({ type: 'videoBlock', attrs: { mdAttrs: {} } })
  },
  {
    tag: 'query',
    node: 'queryBlock',
    inspectable: true,
    extensions: (ctx) => [QueryBlock.configure({ runQuery: ctx.runQuery })],
    slashInsert: () => ({
      type: 'queryBlock',
      attrs: {
        mdAttrs: {
          collection: 'post',
          sort: 'newest',
          layout: 'grid',
          columns: 3,
          limit: 10,
          showImage: true
        }
      }
    })
  },
  {
    tag: 'latest-posts',
    node: 'latestPostsBlock',
    inspectable: true,
    extensions: (ctx) => [
      LatestPostsBlock.configure({ runQuery: ctx.runQuery })
    ],
    // Zero-config (#192): empty attrs round-trip as a clean {% latest-posts /%} and the
    // contract defaults (5 newest posts, list, dates on) apply everywhere.
    slashInsert: () => ({ type: 'latestPostsBlock', attrs: { mdAttrs: {} } })
  },
  {
    tag: 'embed',
    node: 'embedBlock',
    // NOT inspector-driven: the embed card is edited in place (its own node view), never
    // via the inspector rail — so it stays out of INSPECTABLE, exactly as before #563.
    inspectable: false,
    extensions: () => [EmbedBlock]
    // No slashInsert: `embed` is paste-driven (EmbedPaste resolves a provider URL into a
    // ready embed); a cold slash-insert without a URL has nothing to render.
  },
  {
    // The generic fallback (no `tag`): renders any folder block that lacks a dedicated node.
    node: SETU_BLOCK_NODE,
    inspectable: true,
    extensions: (ctx) => [createSetuBlock(ctx.blocks, ctx.blockCores)]
  }
]

/** The Tiptap extensions every registered block contributes, in registry order. Replaces
 *  the hand-maintained block section of the Canvas extensions array. */
export function buildBlockExtensions(ctx: BlockExtensionCtx): Extensions {
  return EDITOR_BLOCKS.flatMap((def) => def.extensions(ctx))
}

/** Registry entries keyed by Markdoc tag (excludes the tag-less `setuBlock` fallback). */
const byTag = new Map<string, EditorBlockDef>(
  EDITOR_BLOCKS.filter(
    (d): d is EditorBlockDef & { tag: string } => d.tag !== undefined
  ).map((d) => [d.tag, d])
)

/** Tiptap node name → Markdoc tag, for every registered node with a fixed tag (all but the
 *  dynamic `setuBlock`). Drives `tagForNode`. */
const nodeToTag = new Map<string, string>(
  EDITOR_BLOCKS.filter(
    (d): d is EditorBlockDef & { tag: string } => d.tag !== undefined
  ).map((d) => [d.node, d.tag])
)

/** The set of node types whose props are inspector-editable — the INSPECTABLE Set,
 *  derived. Includes the generic `setuBlock`. */
export const INSPECTABLE_NODES: ReadonlySet<string> = new Set(
  EDITOR_BLOCKS.filter((d) => d.inspectable).map((d) => d.node)
)

/** The Markdoc tag a selected node maps to. `setuBlock` carries its tag in `attrs.tag`
 *  (one node, many folder tags); every other node has a fixed registry tag. Replaces the
 *  hand-written `tagOf` ternary chain. */
export function tagForNode(
  name: string,
  attrs: Record<string, unknown>,
  attrString: (v: unknown) => string
): string {
  if (name === SETU_BLOCK_NODE) return attrString(attrs.tag)
  return nodeToTag.get(name) ?? ''
}

/** The slash-menu insert payload for a Markdoc tag: a registered block's own payload, or
 *  the generic `setuBlock` fallback (an empty body-bearing node carrying the tag) for any
 *  folder block without a dedicated editor node. Replaces the blocks.ts else-if chain. */
export function insertPayloadForTag(tag: string): JSONContent {
  const def = byTag.get(tag)
  if (def?.slashInsert) return def.slashInsert()
  return {
    type: SETU_BLOCK_NODE,
    attrs: { tag, mdAttrs: {} },
    content: [{ type: 'paragraph' }]
  }
}

/** Whether a Markdoc tag has a dedicated slash-insert payload (vs. the setuBlock fallback).
 *  `embed` is registered but paste-driven, so it has none. */
export function hasSlashInsert(tag: string): boolean {
  return byTag.get(tag)?.slashInsert !== undefined
}
