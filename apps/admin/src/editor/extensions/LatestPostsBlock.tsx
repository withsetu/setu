import { NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { QueryPreview } from '../QueryPreview'
import type { QueryAttrs, RunQuery } from '../QueryPreview'
import { createAtomBlock } from './atom-block'

/** The block's attribute bag, as stored on the node (all optional — zero-config inserts
 *  as `{% latest-posts /%}` and the contract defaults apply everywhere). */
export interface LatestPostsAttrs {
  count?: number
  category?: string
  tag?: string
  locale?: string
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
  if (a.locale) out.locale = a.locale
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
 *  latest-posts→latestPostsBlock, to-markdoc emits a self-closing {% latest-posts … /%}).
 *  Keeps a bespoke node view — the live content-index preview (QueryPreview) — plus the
 *  runQuery option→storage seam; the shared atom-block factory owns only the Node.create
 *  boilerplate here (#562). */
export const LatestPostsBlock = createAtomBlock<
  { runQuery?: RunQuery },
  { runQuery?: RunQuery }
>({
  name: 'latestPostsBlock',
  dataAttr: 'data-setu-latest-posts-block',
  view: LatestPostsView,
  addOptions() {
    return { runQuery: undefined }
  },
  // Seed storage from the option at creation so the very first node-view render already has
  // the live query fn (stable for the editor's lifetime — the editor remounts per entry).
  addStorage() {
    return { runQuery: this.options.runQuery }
  }
})
