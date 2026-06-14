import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Icon } from '../../ui/Icon'

function CalloutView() {
  return (
    <NodeViewWrapper className="blk-callout tone-accent" aria-label="Callout block">
      <span className="callout-ic" contentEditable={false}>
        <Icon name="sparkle" size={18} />
      </span>
      <NodeViewContent className="callout-text" />
    </NodeViewWrapper>
  )
}

/** The config `{% callout %}` block. Schema matches the converter
 *  (packages/core/src/markdoc/to-tiptap.ts): group 'block', block content, and an
 *  `mdAttrs` bag round-tripped verbatim (to-markdoc always serializes the tag as
 *  `{% callout %}`). `mdAttrs` is JSON-only (kept out of the DOM). Tone/icon
 *  pickers are deferred — the node preserves mdAttrs, it just can't change it yet. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      mdAttrs: {
        default: {},
        renderHTML: () => ({}),
        parseHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})
