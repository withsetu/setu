import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { resolveMediaSrc } from '../media-src'

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const apiBase = import.meta.env.VITE_SETU_API
  const src = String(node.attrs.src ?? '')
  const alt = String(node.attrs.alt ?? '')
  return (
    <NodeViewWrapper
      as="span"
      className={`setu-image${selected ? ' is-selected' : ''}`}
      contentEditable={false}
    >
      {/* Not natively draggable: a native img drag duplicates the node through the
          generic img[src] parse rule instead of moving it (#384). */}
      <img
        src={resolveMediaSrc(src, apiBase)}
        alt={alt}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
      {selected && (
        <input
          className="setu-image-alt"
          type="text"
          placeholder="Alt text…"
          value={alt}
          onChange={(e) => updateAttributes({ alt: e.target.value })}
        />
      )}
    </NodeViewWrapper>
  )
}

export const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      title: { default: null }
    }
  },

  addStorage() {
    return {
      onUploading: undefined as ((busy: boolean) => void) | undefined,
      onError: undefined as ((msg: string) => void) | undefined
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  }
})
