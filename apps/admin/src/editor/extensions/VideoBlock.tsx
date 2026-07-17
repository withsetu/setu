import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Video } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'
import { attrStringOrUndefined } from '../attr-string'

function VideoBlockView({ node, editor }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const apiBase =
    (editor.storage as unknown as { imageBlock?: { apiBase?: string } })
      .imageBlock?.apiBase ?? ''
  const resolve = (attr: unknown): string | undefined => {
    const raw = attrStringOrUndefined(attr)
    return raw ? resolveMediaSrc(raw, apiBase || undefined) : undefined
  }
  return (
    <NodeViewWrapper>
      <div className="setu-block" data-tag="video" contentEditable={false}>
        <Video
          src={resolve(md['src'])}
          poster={resolve(md['poster'])}
          caption={attrStringOrUndefined(md['caption'])}
          controls={md['controls'] !== false}
          autoplay={md['autoplay'] === true}
          loop={md['loop'] === true}
          muted={md['muted'] === true}
          width={attrStringOrUndefined(md['width'])}
        />
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% video %}` block — atom (props-only, no body); props edited in the inspector
 *  rail. Mirrors HeroBlock: mdAttrs JSON-only, kept out of the DOM, round-tripped by
 *  the core converter (to-tiptap maps video→videoBlock, to-markdoc emits self-closing). */
export const VideoBlock = Node.create({
  name: 'videoBlock',
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
    return [{ tag: 'div[data-setu-video-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-setu-video-block': '' })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockView)
  }
})
