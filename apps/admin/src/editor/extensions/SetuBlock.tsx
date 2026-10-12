import { Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer
} from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import type { BlockControl, ResolvedBlock } from '@setu/core'
import type { BlockCore } from '@setu/blocks'
import { attrString } from '../attr-string'
import { resolveMediaSrc } from '../media-src'

/** Resolve media-hinted props (control: 'media') to displayable URLs for the canvas —
 *  stored srcs are root-relative `/media/…` paths that need the API origin prepended
 *  (the HeroBlock precedent, generalized). Pure; the stored mdAttrs are untouched. */
export function resolveMediaAttrs(
  mdAttrs: Record<string, unknown>,
  controls: Partial<Record<string, BlockControl>> | undefined,
  apiBase: string | undefined
): Record<string, unknown> {
  if (!controls) return mdAttrs
  let out = mdAttrs
  for (const [name, control] of Object.entries(controls)) {
    const v = mdAttrs[name]
    if (control === 'media' && typeof v === 'string' && v !== '') {
      if (out === mdAttrs) out = { ...mdAttrs }
      out[name] = resolveMediaSrc(v, apiBase)
    }
  }
  return out
}

function viewFor(
  byTag: Record<string, ResolvedBlock>,
  cores: Record<string, BlockCore>
) {
  return function SetuBlockView({ node, editor, getPos }: ReactNodeViewProps) {
    const onMouseDown = (e: React.MouseEvent) => {
      placeCaretFromBlockChrome(
        editor.view,
        e.nativeEvent,
        e.currentTarget,
        getPos
      )
    }
    const tag = attrString(node.attrs.tag)
    const block = byTag[tag]
    const Core = cores[tag]
    const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    const label = block?.editor?.label ?? tag

    // When the block has a registered React core, render the REAL visual with the editable
    // body inside it (the callout pattern). Otherwise fall back to generic chrome.
    if (Core) {
      const apiBase = (
        editor.storage as unknown as { imageBlock?: { apiBase?: string } }
      ).imageBlock?.apiBase
      const coreProps = resolveMediaAttrs(
        mdAttrs,
        block?.editor?.controls,
        apiBase
      )
      return (
        <NodeViewWrapper onMouseDown={onMouseDown}>
          <div className="setu-block" data-tag={tag}>
            <Core {...coreProps}>
              <NodeViewContent />
            </Core>
          </div>
        </NodeViewWrapper>
      )
    }

    return (
      <NodeViewWrapper onMouseDown={onMouseDown}>
        <div className="setu-block" data-tag={tag}>
          <div className="setu-block-head" contentEditable={false}>
            <span className="setu-block-label">{label}</span>
          </div>
          <NodeViewContent className="setu-block-body" />
        </div>
      </NodeViewWrapper>
    )
  }
}

/** Controls inside a block core keep their own click behaviour. */
const INTERACTIVE =
  'a[href], button, input, select, textarea, [role="button"], [role="combobox"]'

/** A primary click on a folder block's NON-editable chrome — the generic label head, or a
 *  block core's own markup such as Notice's title — puts the caret at the start of THAT
 *  block's body, so the block is selected and the inspector opens (#1223). Returns true
 *  when it handled the click.
 *
 *  Intended to stay independent of how prosemirror-view maps DOM positions outside a node
 *  view's content: 1.42.6 changed `posAtDOM` there, and the same click that had landed
 *  in the block body began landing in the paragraph after the block. So the target block
 *  comes from the node view's own `getPos()`, never from the DOM.
 *
 *  Wired as the node view wrapper's onMouseDown, not a ProseMirror plugin: Tiptap's
 *  NodeView.stopEvent claims mousedowns on a node view's chrome, so plugins never see
 *  them, and the caret used to move afterwards when ProseMirror read the browser's DOM
 *  selection. preventDefault() stops the browser placing that DOM selection at all.
 *  apps/admin/test-browser/setu-block-chrome-click.test.tsx fails if this stops holding. */
export function placeCaretFromBlockChrome(
  view: EditorView,
  event: MouseEvent,
  wrapper: Element,
  getPos: () => number | undefined
): boolean {
  if (event.defaultPrevented || event.button !== 0 || !view.editable)
    return false
  const target = event.target
  if (!(target instanceof Element)) return false
  // Only this node view's own chrome: the first `.setu-block` inside the wrapper is its
  // own, and a nested block's chrome resolves to the nested block (handled there first).
  const own = wrapper.querySelector('.setu-block')
  if (!own || target.closest('.setu-block') !== own) return false
  // The first content element inside the block is its own; nested blocks sit inside it.
  const content = own.querySelector('[data-node-view-content]')
  if (!content || content.contains(target)) return false
  if (target.closest(INTERACTIVE)) return false
  const pos = getPos()
  if (typeof pos !== 'number') return false
  event.preventDefault()
  view.focus()
  const $inside = view.state.doc.resolve(pos + 1)
  view.dispatch(view.state.tr.setSelection(TextSelection.near($inside)))
  return true
}

/** The generic folder-block node. `tag` selects the registry entry + (optionally) a React
 *  core; `mdAttrs` is the round-tripped attribute bag (JSON-only, kept out of the DOM like
 *  callout). With a core, the view renders the real visual; otherwise generic chrome. */
export function createSetuBlock(
  blocks: ResolvedBlock[],
  cores: Record<string, BlockCore> = {}
): Node {
  const byTag = Object.fromEntries(blocks.map((b) => [b.tag, b]))
  return Node.create({
    name: 'setuBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes() {
      return {
        tag: {
          default: '',
          renderHTML: () => ({}),
          parseHTML: (el: HTMLElement) => el.getAttribute('data-tag') ?? ''
        },
        mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) },
        // #967: the author wrote this tag's body on ONE line
        // (`{% button %}Get started{% /button %}`, the shape kitchen-sink.mdoc ships).
        // Declared here so ProseMirror carries it instead of stripping it as an unknown
        // attribute — without it the writer normalises the tag to the `\n`-wrapped form
        // on the first autosave, which renders differently (`<Button><p>x</p></Button>`
        // rather than `<p><Button>x</Button></p>`). JSON-only, like mdAttrs.
        // Round-trip covered by packages/core/test/single-line-tag-roundtrip.test.ts;
        // the schema declaration itself by apps/admin/test/editor-schema.test.tsx.
        inlineBody: {
          default: false,
          renderHTML: () => ({}),
          parseHTML: () => false
        }
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-setu-block]' }]
    },
    renderHTML({ HTMLAttributes, node }) {
      return [
        'div',
        {
          ...HTMLAttributes,
          'data-setu-block': '',
          'data-tag': attrString(node.attrs.tag)
        },
        0
      ]
    },
    addNodeView() {
      return ReactNodeViewRenderer(viewFor(byTag, cores))
    }
  })
}
