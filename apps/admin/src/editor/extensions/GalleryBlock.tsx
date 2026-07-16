import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Gallery, galleryImagesOf } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'
import { attrStringOrUndefined } from '../attr-string'

function GalleryBlockView({ node, editor }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const apiBase =
    (editor.storage as unknown as { imageBlock?: { apiBase?: string } })
      .imageBlock?.apiBase ?? ''
  const images = galleryImagesOf(md['images']).map((img) => ({
    ...img,
    src: resolveMediaSrc(img.src, apiBase || undefined)
  }))
  return (
    <NodeViewWrapper>
      <div className="setu-block" data-tag="gallery" contentEditable={false}>
        <Gallery
          images={images}
          columns={
            typeof md['columns'] === 'number' ? md['columns'] : undefined
          }
          gap={attrStringOrUndefined(md['gap'])}
          captions={md['captions'] === true}
          width={attrStringOrUndefined(md['width'])}
        />
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% gallery %}` block — atom (props-only, no body); images + options edited in
 *  the inspector rail (media-list control). Mirrors HeroBlock: mdAttrs JSON-only, kept
 *  out of the DOM, round-tripped by the core converter (to-tiptap maps
 *  gallery→galleryBlock, to-markdoc emits self-closing). */
export const GalleryBlock = Node.create({
  name: 'galleryBlock',
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
    return [{ tag: 'div[data-setu-gallery-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-setu-gallery-block': '' })
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(GalleryBlockView)
  }
})
