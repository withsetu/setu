import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { resolveMediaSrc } from '../media-src'
import { useMirroredField } from '../useMirroredField'

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const apiBase = import.meta.env.VITE_SETU_API
  const src = String(node.attrs.src ?? '')
  const alt = String(node.attrs.alt ?? '')
  // Alt is a free-text input: mirror its value in local state so a clear right after
  // typing is not swallowed by 3.28's deferred node-view re-render (#691). `alt` is a
  // direct node attr here (not mdAttrs); the hook is agnostic to that.
  const altField = useMirroredField(alt, (v) => updateAttributes({ alt: v }))
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
          value={altField.value}
          onChange={(e) => altField.onChange(e.target.value)}
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
