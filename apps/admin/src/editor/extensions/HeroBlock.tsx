import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Hero } from '@setu/blocks'
import type { HeroProps } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'

function HeroBlockView({ node, editor }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const apiBase = (editor.storage as unknown as { imageBlock?: { apiBase?: string } }).imageBlock?.apiBase ?? ''
  const image = md['image'] ? resolveMediaSrc(String(md['image']), apiBase || undefined) : undefined
  return (
    <NodeViewWrapper>
      <div className="setu-block" data-tag="hero" contentEditable={false}>
        <Hero
          headline={String(md['headline'] ?? 'Hero headline')}
          subhead={md['subhead'] ? String(md['subhead']) : undefined}
          image={image}
          ctaLabel={md['ctaLabel'] ? String(md['ctaLabel']) : undefined}
          ctaHref={md['ctaHref'] ? String(md['ctaHref']) : undefined}
          layout={md['layout'] ? String(md['layout']) as HeroProps['layout'] : undefined}
          textPosition={md['textPosition'] ? String(md['textPosition']) : undefined}
          overlayColor={md['overlayColor'] ? String(md['overlayColor']) : undefined}
          width={md['width'] ? String(md['width']) : undefined}
        />
      </div>
    </NodeViewWrapper>
  )
}

/** The `{% hero %}` block — atom (props-only, no body); props edited in the inspector rail.
 *  Mirrors ImageBlock/ContactBlock: mdAttrs JSON-only, kept out of the DOM, round-tripped
 *  by the core converter (to-tiptap maps hero→heroBlock, to-markdoc emits self-closing). */
export const HeroBlock = Node.create({
  name: 'heroBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-setu-hero-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-setu-hero-block': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(HeroBlockView)
  },
})
