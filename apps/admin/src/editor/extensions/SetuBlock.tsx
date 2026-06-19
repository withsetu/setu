import { Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { markdocAttributesFor } from '@setu/core'
import type { ResolvedBlock } from '@setu/core'

function viewFor(byTag: Record<string, ResolvedBlock>) {
  return function SetuBlockView({ node, updateAttributes }: ReactNodeViewProps) {
    const tag = String(node.attrs.tag)
    const block = byTag[tag]
    const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    // Derive the form from the same zod props the contract declares (DRY with the codegen).
    const attrs = block ? markdocAttributesFor(block.props) : {}
    const label = block?.editor?.label ?? tag

    const setAttr = (name: string, value: string) => {
      const next: Record<string, unknown> = { ...mdAttrs }
      if (value === '') delete next[name]
      else next[name] = value
      updateAttributes({ mdAttrs: next })
    }

    return (
      <NodeViewWrapper>
        <div className="setu-block" data-tag={tag}>
          <div className="setu-block-head" contentEditable={false}>
            <span className="setu-block-label">{label}</span>
          </div>
          {Object.keys(attrs).length > 0 && (
            <div className="block-props" contentEditable={false} role="group" aria-label={`${label} properties`}>
              {Object.entries(attrs).map(([name, a]) => (
                <label key={name} className="bp-field">
                  <span className="bp-label">{name}</span>
                  {a.matches ? (
                    <select value={String(mdAttrs[name] ?? a.default ?? '')} onChange={(e) => setAttr(name, e.target.value)}>
                      {a.matches.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" value={String(mdAttrs[name] ?? '')} onChange={(e) => setAttr(name, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
          )}
          <NodeViewContent className="setu-block-body" />
        </div>
      </NodeViewWrapper>
    )
  }
}

/** The generic folder-block node. One Tiptap node serves every HTML+contract block: `tag`
 *  selects the registry entry, `mdAttrs` is the round-tripped attribute bag (JSON-only, kept
 *  out of the DOM like callout). The view auto-generates the attr form from the block's zod props. */
export function createSetuBlock(blocks: ResolvedBlock[]): Node {
  const byTag = Object.fromEntries(blocks.map((b) => [b.tag, b]))
  return Node.create({
    name: 'setuBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes() {
      return {
        tag: { default: '', renderHTML: () => ({}), parseHTML: (el: HTMLElement) => el.getAttribute('data-tag') ?? '' },
        mdAttrs: { default: {}, renderHTML: () => ({}), parseHTML: () => ({}) },
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-setu-block]' }]
    },
    renderHTML({ HTMLAttributes, node }) {
      return ['div', { ...HTMLAttributes, 'data-setu-block': '', 'data-tag': node.attrs.tag }, 0]
    },
    addNodeView() {
      return ReactNodeViewRenderer(viewFor(byTag))
    },
  })
}
