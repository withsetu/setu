import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'

// ---------------------------------------------------------------------------------
// Shared factory for the "atom" content blocks — props-only nodes (no body) whose
// Markdoc form is self-closing ({% hero /%}). Every one of them ended in a Node.create
// structurally identical to the HeroBlock precedent: group:'block' + atom + draggable +
// selectable, an mdAttrs-only `addAttributes` kept out of the DOM, a one-line data-attr
// parseHTML, a mergeAttributes renderHTML, and `addNodeView(ReactNodeViewRenderer(view))`.
// This factory owns that boilerplate once; each block supplies only what actually varies
// (its node name, its data-attr, and its view). The simple read-only atoms additionally
// share the canvas view shape (a `.setu-block` wrapper rendering a @setu/blocks core from
// mdAttrs, media srcs resolved against the shared imageBlock storage) — `atomCoreView`
// builds that, leaving each block only its tiny mdAttrs→core-props mapping. (#562)
// ---------------------------------------------------------------------------------

/** The canvas media origin, from the shared `imageBlock` storage seam. Every atom core
 *  resolves root-relative `/media/…` srcs against this; the derivation was copy-pasted
 *  identically across the hero/gallery/video views. */
export function atomApiBase(editor: Editor): string {
  return (
    (editor.storage as unknown as { imageBlock?: { apiBase?: string } })
      .imageBlock?.apiBase ?? ''
  )
}

/** Build a read-only canvas view that renders a @setu/blocks core from the node's
 *  mdAttrs. `mapProps` turns the raw attr bag (+ the resolved apiBase) into the core's
 *  props — the ONLY per-block variation once the `.setu-block` wrapper is shared. `tag`
 *  is the Markdoc tag the wrapper advertises as `data-tag` (the inspector rail keys on
 *  it). The view holds no state, so it cannot drive the selection→transaction render
 *  loop that white-screened the editor twice (CLAUDE.md §4 #3) — `selected` is a prop
 *  ProseMirror pushes, not state we derive.
 *
 *  `selected` drives the canvas selection ring (`.setu-block.is-selected`, styled once
 *  in editor.css): these atoms are edited entirely from the inspector rail, so without
 *  it nothing on the page says WHICH block the rail is editing (#778). */
export function atomCoreView<P extends object>(
  tag: string,
  Core: ComponentType<P>,
  mapProps: (md: Record<string, unknown>, apiBase: string) => P
): ComponentType<ReactNodeViewProps> {
  return function AtomCoreView({ node, editor, selected }: ReactNodeViewProps) {
    const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    return (
      <NodeViewWrapper>
        <div
          className={`setu-block${selected ? ' is-selected' : ''}`}
          data-tag={tag}
          contentEditable={false}
        >
          <Core {...mapProps(md, atomApiBase(editor))} />
        </div>
      </NodeViewWrapper>
    )
  }
}

export interface AtomBlockConfig<Options, Storage> {
  /** Tiptap node name, e.g. `heroBlock` (distinct from the Markdoc tag `hero`). */
  name: string
  /** The DOM data-attribute that identifies the node on parse/serialize, e.g.
   *  `data-setu-hero-block`. Kept unique per block so parseHTML never cross-matches. */
  dataAttr: string
  /** The React node view. Use `atomCoreView(...)` for the simple read-only cores, or a
   *  bespoke component for atoms with interactive canvas views (spacer, latest-posts). */
  view: ComponentType<ReactNodeViewProps>
  /** Optional Tiptap `addOptions` (bound as a node method so `this` works). Mirrors
   *  Tiptap's own `this` shape (options don't exist yet at this stage). */
  addOptions?: (this: {
    name: string
    parent: (() => Options) | undefined
  }) => Options
  /** Optional Tiptap `addStorage` (bound as a node method; reads `this.options`). */
  addStorage?: (this: { name: string; options: Options }) => Storage
}

/** Create an atom-block node from the shared shape. Behaviour-identical to the
 *  hand-written `Node.create({...})` each of these blocks used to end in. */
export function createAtomBlock<
  Options = Record<string, never>,
  Storage = Record<string, never>
>(config: AtomBlockConfig<Options, Storage>): Node<Options, Storage> {
  const { name, dataAttr, view, addOptions, addStorage } = config
  return Node.create<Options, Storage>({
    name,
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    ...(addOptions ? { addOptions } : {}),
    ...(addStorage ? { addStorage } : {}),
    addAttributes() {
      return {
        mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) }
      }
    },
    parseHTML() {
      return [{ tag: `div[${dataAttr}]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { [dataAttr]: '' })]
    },
    addNodeView() {
      return ReactNodeViewRenderer(view)
    }
  })
}
