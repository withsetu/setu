import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { QueryPreview } from '../QueryPreview'
import type { QueryAttrs, RunQuery } from '../QueryPreview'

function QueryBlockView({ node, editor, selected }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as QueryAttrs
  // runQuery is injected by Canvas from the live IndexProvider (same pattern as
  // imageBlock.apiBase) so the node view stays out of React context.
  const storage = editor.storage as unknown as {
    queryBlock?: { runQuery?: RunQuery }
    imageBlock?: { apiBase?: string }
  }
  const runQuery = storage.queryBlock?.runQuery
  const apiBase = storage.imageBlock?.apiBase
  return (
    <NodeViewWrapper>
      <div
        className={`setu-block${selected ? ' is-selected' : ''}`}
        data-tag="query"
        contentEditable={false}
      >
        <QueryPreview attrs={md} runQuery={runQuery} apiBase={apiBase} />
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% query %}` block — atom (props-only, no body); props edited in the grouped block-inspector
 *  rail with a live preview here in the canvas. Mirrors HeroBlock/ImageBlock: mdAttrs is
 *  JSON-only, kept out of the DOM, round-tripped by the core converter (to-tiptap maps
 *  query→queryBlock, to-markdoc emits a self-closing {% query … /%}). */
export const QueryBlock = Node.create<{ runQuery?: RunQuery }>({
  name: 'queryBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { runQuery: undefined }
  },
  // Seed storage from the option at creation so the very first node-view render already has
  // the live query fn (runQuery is stable for the editor's lifetime — the editor remounts per
  // entry). No reliance on a post-mount effect.
  addStorage() {
    return { runQuery: this.options.runQuery }
  },
  addAttributes() {
    return {
      mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-setu-query-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-setu-query-block': '' })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(QueryBlockView)
  }
})
