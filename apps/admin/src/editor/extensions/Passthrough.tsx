import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Icon } from '../../ui/Icon'
import { attrString } from '../attr-string'

function PassthroughView({ node }: ReactNodeViewProps) {
  const attrs = node.attrs as Record<string, unknown>
  const raw = attrString(attrs['raw'])
  const flagged = Boolean(attrs['flagged'])
  return (
    <NodeViewWrapper
      className={`blk-dynamic${flagged ? ' is-flagged' : ''}`}
      contentEditable={false}
      aria-label="Preserved Markdoc block (read-only)"
    >
      <div className="dyn-rail" />
      <div className="dyn-head">
        <span className="dyn-ic">
          <Icon name="zap" size={15} />
        </span>
        <span className="dyn-title">
          {flagged ? 'Unparsed Markdoc' : 'Advanced Markdoc'}
        </span>
        <span className="dyn-lock">
          <Icon name="lock" size={14} />
        </span>
      </div>
      <pre className="dyn-raw">
        <code>{raw}</code>
      </pre>
    </NodeViewWrapper>
  )
}

/** Unknown/advanced Markdoc preserved verbatim (the never-drop guarantee).
 *  Atom (leaf) + `raw`/`flagged` attrs matching the converter; to-markdoc emits
 *  `raw` verbatim. Read-only (contentEditable=false) but selectable/deletable. */
export const Passthrough = Node.create({
  name: 'passthrough',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      raw: { default: '', renderHTML: () => ({}), parseHTML: () => ({}) },
      flagged: { default: false, renderHTML: () => ({}), parseHTML: () => ({}) }
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
  }
})
