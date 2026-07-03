import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Hero } from '@setu/blocks'
import type { HeroProps } from '@setu/blocks'
import { resolveMediaSrc } from '../media-src'
import { attrString, attrStringOrUndefined } from '../attr-string'

function HeroBlockView({ node, editor }: ReactNodeViewProps) {
  const md = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const apiBase = (editor.storage as unknown as { imageBlock?: { apiBase?: string } }).imageBlock?.apiBase ?? ''
  const imageAttr = attrStringOrUndefined(md['image'])
  const image = imageAttr ? resolveMediaSrc(imageAttr, apiBase || undefined) : undefined
  return (
    <NodeViewWrapper>
      <div className="setu-block" data-tag="hero" contentEditable={false}>
        <Hero
          headline={attrString(md['headline'], 'Hero headline')}
          subhead={attrStringOrUndefined(md['subhead'])}
          image={image}
          ctaLabel={attrStringOrUndefined(md['ctaLabel'])}
          ctaHref={attrStringOrUndefined(md['ctaHref'])}
          layout={attrStringOrUndefined(md['layout']) as HeroProps['layout']}
          textPosition={attrStringOrUndefined(md['textPosition'])}
          textAlign={attrStringOrUndefined(md['textAlign'])}
          overlayColor={attrStringOrUndefined(md['overlayColor'])}
          textColor={attrStringOrUndefined(md['textColor'])}
          width={attrStringOrUndefined(md['width'])}
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
