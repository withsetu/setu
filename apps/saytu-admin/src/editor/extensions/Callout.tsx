import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/Icon'
import { isIconName } from '../../ui/Icon'
import { calloutVariants, variantFor, CALLOUT_ICONS } from '../callout-variants'

function CalloutView({ node, updateAttributes }: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const type = String(mdAttrs['type'] ?? 'info')
  const title = String(mdAttrs['title'] ?? '')
  const variant = variantFor(type)
  const overrideIcon = mdAttrs['icon']
  const icon: IconName = typeof overrideIcon === 'string' && isIconName(overrideIcon) ? overrideIcon : variant.icon

  const setAttrs = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...mdAttrs, ...patch }
    if (next['title'] === '') delete next['title']
    if (next['icon'] === '') delete next['icon']
    updateAttributes({ mdAttrs: next })
  }

  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

  return (
    <NodeViewWrapper className={`blk-callout tone-${variant.tone}`} aria-label="Callout block">
      <div className="block-props" contentEditable={false}>
        <span className="bp-label">Tone</span>
        {calloutVariants().map((v) => (
          <button
            key={v.type}
            type="button"
            className={`bp-swatch tone-${v.tone}${type === v.type ? ' on' : ''}`}
            title={v.label}
            aria-label={v.label}
            onMouseDown={keepFocus}
            onClick={() => setAttrs({ type: v.type })}
          />
        ))}
        <span className="bp-sep" />
        {CALLOUT_ICONS.map((ic) => (
          <button
            key={ic}
            type="button"
            className={`bp-icon${icon === ic ? ' on' : ''}`}
            title={ic}
            aria-label={`Icon ${ic}`}
            onMouseDown={keepFocus}
            onClick={() => setAttrs({ icon: ic })}
          >
            <Icon name={ic} size={15} />
          </button>
        ))}
      </div>
      <div className="callout-head" contentEditable={false}>
        <span className="callout-ic"><Icon name={icon} size={18} /></span>
        <input
          className="callout-title"
          placeholder="Add a title…"
          value={title}
          onChange={(e) => setAttrs({ title: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}

/** The config `{% callout %}` block. Schema matches the converter
 *  (packages/core/src/markdoc/to-tiptap.ts): group 'block', block content, and an
 *  `mdAttrs` bag round-tripped verbatim (to-markdoc always serializes the tag as
 *  `{% callout %}`). `mdAttrs` is JSON-only (kept out of the DOM). The node view
 *  edits `mdAttrs.type` (tone), `mdAttrs.title`, and `mdAttrs.icon` via a toolbar. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      mdAttrs: {
        default: {},
        renderHTML: () => ({}),
        parseHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})
