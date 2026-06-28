import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { resolveMediaSrc } from '../media-src'
import { useToolbarRoving } from '../useToolbarRoving'
import { replaceImage } from '../image-insert'
import { AlignControl } from '../controls/align'

interface ImageBlockStorage {
  apiBase: string
  onUploading?: (busy: boolean) => void
  onError?: (msg: string) => void
  /** Open the pick-or-upload library modal; the chosen src is handed to `onPick`.
   *  Wired by Canvas. Undefined in non-Canvas contexts (Replace falls back to a
   *  direct upload then). */
  openPicker?: (onPick: (src: string) => void) => void
}

function ImageBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const storage = (editor.storage as unknown as { imageBlock: ImageBlockStorage }).imageBlock
  const apiBase = storage?.apiBase ?? ''
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const src = String(mdAttrs['src'] ?? '')
  const alt = String(mdAttrs['alt'] ?? '')
  const caption = String(mdAttrs['caption'] ?? '')
  const align = String(mdAttrs['align'] ?? 'none')

  const setAttrs = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...mdAttrs, ...patch }
    if (next['caption'] === '') delete next['caption']
    if (next['alt'] === '') delete next['alt']
    updateAttributes({ mdAttrs: next })
  }

  const onCaptionKeyDown = (e: React.KeyboardEvent) => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    if (e.key === 'Enter') {
      e.preventDefault()
      // exit downward: new empty paragraph right after the image block, caret inside it
      editor.chain().insertContentAt(pos + node.nodeSize, { type: 'paragraph' }).setTextSelection(pos + node.nodeSize + 1).focus().run()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      editor.chain().setTextSelection(pos + node.nodeSize).focus().run()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      editor.chain().setTextSelection(Math.max(pos - 1, 0)).focus().run()
      return
    }
    e.stopPropagation()
  }

  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()
  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()
  const onReplace = () => {
    const apply = (newSrc: string) => setAttrs({ src: newSrc })
    // Prefer the library modal (pick OR upload) when it's wired; otherwise fall
    // back to a direct upload (e.g. unit tests / non-Canvas contexts).
    if (storage?.openPicker) storage.openPicker(apply)
    else replaceImage(apiBase, { onUploading: storage?.onUploading, onError: storage?.onError }, apply)
  }

  return (
    <NodeViewWrapper>
      <figure className={`setu-image-block align-${align}`} contentEditable={false}>
        <div className="block-props" role="toolbar" aria-label="Image" ref={toolbarRef} onKeyDown={onToolbarKeyDown}>
          <span className="bp-label">Align</span>
          <AlignControl
            value={align}
            onChange={(v) => setAttrs({ align: String(v) })}
            meta={{ name: 'align', options: ['none', 'left', 'right', 'wide', 'full'], apiBase: '', onPickMedia: () => {} }}
          />
          <span className="bp-sep" />
          <input
            className="sib-alt"
            placeholder="Alt text…"
            value={alt}
            onChange={(e) => setAttrs({ alt: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            data-toolbar-item
          />
          <button type="button" className="bp-replace" data-toolbar-item onMouseDown={keepFocus} onClick={onReplace}>
            Replace
          </button>
        </div>
        <img className="sib-img" src={resolveMediaSrc(src, apiBase || undefined)} alt={alt} />
        <input
          className="sib-caption"
          placeholder="Add a caption…"
          value={caption}
          onChange={(e) => setAttrs({ caption: e.target.value })}
          onKeyDown={onCaptionKeyDown}
        />
      </figure>
    </NodeViewWrapper>
  )
}

/** The `{% image %}` block. Atom (no body) — schema matches the converter
 *  (packages/core/src/markdoc/to-tiptap.ts maps the tag to this node only when
 *  `image ∈ knownBlockTags`). `mdAttrs` (src/alt/caption/align) is JSON-only and
 *  round-tripped verbatim; to-markdoc serializes it self-closing. */
export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) } }
  },
  addStorage(): ImageBlockStorage {
    return { apiBase: '', onUploading: undefined, onError: undefined, openPicker: undefined }
  },
  parseHTML() {
    return [{ tag: 'figure[data-setu-image-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-setu-image-block': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView)
  },
})
