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
  ratio?: string
  align?: string
  width?: unknown
  height?: unknown
}

/** The aspect-ratio ladder blocks/embed/embed.astro applies on the site: an explicit
 *  ratio wins, else the resolved width/height when both are positive numbers, else 16 / 9.
 *  Mirrored here so the canvas card has the shape the published embed will have. */
const RATIOS: Record<string, string> = {
  '16:9': '16 / 9',
  '4:3': '4 / 3',
  '1:1': '1 / 1',
  '21:9': '21 / 9'
}
const positive = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null

function embedAspect(md: EmbedAttrs): string {
  if (md.ratio && RATIOS[md.ratio]) return RATIOS[md.ratio]!
  const w = positive(md.width)
  const h = positive(md.height)
  return w !== null && h !== null ? `${w} / ${h}` : '16 / 9'
}

/** In-canvas preview card for the embed block — a static representation from the resolved
 *  oEmbed attrs (no async, no selection-driven state → jsdom-safe). The real interactive player
 *  renders on the published site (blocks/embed/embed.astro). The presentation props edited in
 *  the inspector rail show here as on the site: the caption sits under the card, the media box
 *  takes the aspect ratio, and `align-wide`/`align-full` on the figure trips the canvas
 *  breakout rules in styles/editor.css — driven by
 *  apps/admin/test-browser/embed-inspector.test.tsx. */
function EmbedBlockView({ node, selected }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as EmbedAttrs
  const label = md.providerLabel ?? md.provider ?? 'Embed'
  const isVideo = md.mediaType === 'video'
  const alignClass =
    md.align === 'wide'
      ? ' align-wide'
      : md.align === 'full'
        ? ' align-full'
        : ''
  const caption = typeof md.caption === 'string' ? md.caption : ''
  return (
    <NodeViewWrapper>
      <figure className={`my-4${alignClass}`} contentEditable={false}>
        <div
          className={`setu-canvas-card overflow-hidden rounded-lg border border-border bg-card${selected ? ' is-selected' : ''}`}
          data-tag="embed"
        >
          <div
            className="relative bg-muted"
            style={{ aspectRatio: embedAspect(md) }}
            data-embed-media=""
          >
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
          <div className="p-3">
            <div className="truncate text-sm font-medium text-foreground">
              {md.title || md.url || 'Embed'}
            </div>
          </div>
        </div>
        {caption && (
          <figcaption
            className="mt-2 text-center text-sm text-muted-foreground"
            data-embed-caption=""
          >
            {caption}
          </figcaption>
        )}
      </figure>
    </NodeViewWrapper>
  )
}

/** The `{% embed %}` block — a bodyless atom (like queryBlock/heroBlock). Inserted by the
 *  paste-to-embed handler (EmbedPaste) with resolved oEmbed attrs. Its presentation props
 *  (caption / ratio / align) are edited in the block inspector rail — the registry marks it
 *  inspectable (block-registry.ts; apps/admin/test-browser/embed-inspector.test.tsx); the
 *  resolved data props are `managed` and get no control. Core converter maps
 *  embed↔embedBlock (self-closing tag, no body). */
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
