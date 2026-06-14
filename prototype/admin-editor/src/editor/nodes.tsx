import { Node, mergeAttributes } from '@tiptap/core'
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from '@tiptap/react'

/**
 * Callout — a real editable block with a NodeView.
 * Demonstrates a config-defined "normal block" (static props, fully editable).
 */
function CalloutView() {
  return (
    <NodeViewWrapper
      className="my-3 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      aria-label="Callout block"
    >
      <div contentEditable={false} className="select-none text-lg leading-7">
        💡
      </div>
      <NodeViewContent className="prose-callout flex-1" />
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,
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

/**
 * PassthroughChip — the markdocPassthrough node.
 * Advanced/dynamic Markdoc the editor has no first-class UI for: rendered as a
 * labeled, read-only chip, preserved verbatim, flagged Pro. Never editable here,
 * never dropped on save.
 */
function PassthroughView(props: any) {
  const { label, raw } = props.node.attrs
  return (
    <NodeViewWrapper
      className="my-3"
      contentEditable={false}
      aria-label={`Dynamic Markdoc block: ${label} (read-only, Pro)`}
    >
      <div className="flex items-center justify-between rounded-lg border border-dashed border-violet-300 bg-violet-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-violet-800">
          <span aria-hidden>⚡</span>
          <span className="font-medium">{label}</span>
          <code className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-xs text-violet-700">
            {raw}
          </code>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">
          PRO <span aria-hidden>🔒</span>
        </span>
      </div>
    </NodeViewWrapper>
  )
}

export const PassthroughChip = Node.create({
  name: 'passthrough',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      label: { default: 'Dynamic content' },
      raw: { default: '{% if %}' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-passthrough]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-passthrough': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PassthroughView)
  },
})
