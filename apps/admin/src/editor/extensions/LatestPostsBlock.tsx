import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { QueryPreview } from '../QueryPreview'
import type { QueryAttrs, RunQuery } from '../QueryPreview'

/** The block's attribute bag, as stored on the node (all optional — zero-config inserts
 *  as `{% latest-posts /%}` and the contract defaults apply everywhere). */
export interface LatestPostsAttrs {
  count?: number
  category?: string
  tag?: string
  layout?: 'list' | 'grid'
  columns?: '2' | '3'
  showDate?: boolean
  showExcerpt?: boolean
  showImage?: boolean
}

/** Project latest-posts attrs onto the query preview's attr bag: the canvas preview IS the
 *  query block's live content-index preview pinned to "newest posts" (#192) — one seam,
 *  no forked lookalike. Mirrors the contract defaults in
 *  packages/core/src/blocks/standard/latest-posts.ts. */
export function latestPostsQueryAttrs(a: LatestPostsAttrs): QueryAttrs {
  const out: QueryAttrs = {
    collection: 'post',
    sort: 'newest',
    limit: Math.min(24, Math.max(1, Number(a.count) || 5)),
    layout: a.layout ?? 'list',
    columns: String(a.columns) === '3' ? 3 : 2,
    showImage: a.showImage ?? false
  }
  if (a.category) out.category = a.category
  if (a.tag) out.tag = a.tag
  return out
}

function LatestPostsView({ node, editor }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as LatestPostsAttrs
  // runQuery is injected by Canvas from the live IndexProvider (same pattern as
  // queryBlock.runQuery / imageBlock.apiBase) so the node view stays out of React context.
  const storage = editor.storage as unknown as {
    latestPostsBlock?: { runQuery?: RunQuery }
    imageBlock?: { apiBase?: string }
  }
  return (
    <NodeViewWrapper>
      <div
        className="setu-block"
        data-tag="latest-posts"
        contentEditable={false}
      >
        <QueryPreview
          attrs={latestPostsQueryAttrs(md)}
          runQuery={storage.latestPostsBlock?.runQuery}
          apiBase={storage.imageBlock?.apiBase}
          header="Latest Posts"
          showDate={md.showDate ?? true}
          showExcerpt={md.showExcerpt ?? false}
        />
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% latest-posts %}` block — atom (props-only, no body); props edited in the grouped
 *  block-inspector rail with a live preview here in the canvas. Mirrors QueryBlock: mdAttrs
 *  is JSON-only, kept out of the DOM, round-tripped by the core converter (to-tiptap maps
 *  latest-posts→latestPostsBlock, to-markdoc emits a self-closing {% latest-posts … /%}). */
export const LatestPostsBlock = Node.create<{ runQuery?: RunQuery }>({
  name: 'latestPostsBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { runQuery: undefined }
  },
  // Seed storage from the option at creation so the very first node-view render already has
  // the live query fn (stable for the editor's lifetime — the editor remounts per entry).
  addStorage() {
    return { runQuery: this.options.runQuery }
  },
  addAttributes() {
    return {
      mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-setu-latest-posts-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-setu-latest-posts-block': '' })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(LatestPostsView)
  }
})
