import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Play } from 'lucide-react'

interface EmbedAttrs {
  url?: string
  provider?: string
  providerLabel?: string
  mediaType?: string
  title?: string
  thumbnailUrl?: string
  embedUrl?: string
  caption?: string
}

/** In-canvas preview card for the embed block — a static representation from the resolved
 *  oEmbed attrs (no async, no selection-driven state → jsdom-safe). The real interactive player
 *  renders on the published site (blocks/embed/embed.astro). */
function EmbedBlockView({ node }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as EmbedAttrs
  const label = md.providerLabel ?? md.provider ?? 'Embed'
  const isVideo = md.mediaType === 'video'
  return (
    <NodeViewWrapper>
      <div
        className="my-4 overflow-hidden rounded-lg border border-border bg-card"
        data-tag="embed"
        contentEditable={false}
      >
        <div className="relative aspect-video bg-muted">
          {md.thumbnailUrl && (
            <img
              src={md.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          )}
          {isVideo && (
            <span className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </span>
          )}
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {label}
          </span>
        </div>
        <div className="space-y-0.5 p-3">
          <div className="truncate text-sm font-medium text-foreground">
            {md.title || md.url || 'Embed'}
          </div>
          {md.caption && (
            <div className="truncate text-xs text-muted-foreground">
              {md.caption}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% embed %}` block — a bodyless atom (like queryBlock/heroBlock). Inserted by the
 *  paste-to-embed handler (EmbedPaste) with resolved oEmbed attrs; props edited in the block
 *  inspector. Core converter maps embed↔embedBlock (self-closing tag, no body). */
export const EmbedBlock = Node.create({
  name: 'embedBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-setu-embed-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-setu-embed-block': '' })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedBlockView)
  }
})
