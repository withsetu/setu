import { Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import type { ComponentType } from 'react'
import { markdocAttributesFor } from '@setu/core'
import type { ResolvedBlock } from '@setu/core'

function viewFor(byTag: Record<string, ResolvedBlock>, cores: Record<string, ComponentType<any>>) {
  return function SetuBlockView({ node, updateAttributes }: ReactNodeViewProps) {
    const tag = String(node.attrs.tag)
    const block = byTag[tag]
    const Core = cores[tag]
    const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
    // Derive the form from the same zod props the contract declares (DRY with the codegen).
    const attrs = block ? markdocAttributesFor(block.props) : {}
    const label = block?.editor?.label ?? tag

    const setAttr = (name: string, value: unknown) => {
      const next: Record<string, unknown> = { ...mdAttrs }
      if (value === '') delete next[name]
      else next[name] = value
      updateAttributes({ mdAttrs: next })
    }

    const form =
      Object.keys(attrs).length > 0 ? (
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
              ) : a.type === 'Number' ? (
                <input
                  type="number"
                  value={String(mdAttrs[name] ?? a.default ?? '')}
                  onChange={(e) => (e.target.value === '' ? setAttr(name, '') : setAttr(name, Number(e.target.value)))}
                />
              ) : a.type === 'Boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(mdAttrs[name] ?? a.default ?? false)}
                  onChange={(e) => setAttr(name, e.target.checked)}
                />
              ) : (
                <input type="text" value={String(mdAttrs[name] ?? '')} onChange={(e) => setAttr(name, e.target.value)} />
              )}
            </label>
          ))}
        </div>
      ) : null

    // When the block has a registered React core, render the REAL visual with the editable
    // body inside it (the callout pattern). Otherwise fall back to generic chrome.
    if (Core) {
      return (
        <NodeViewWrapper>
          <div className="setu-block" data-tag={tag}>
            {form}
            <Core {...mdAttrs}>
              <NodeViewContent />
            </Core>
          </div>
        </NodeViewWrapper>
      )
    }

    return (
      <NodeViewWrapper>
        <div className="setu-block" data-tag={tag}>
          <div className="setu-block-head" contentEditable={false}>
            <span className="setu-block-label">{label}</span>
          </div>
          {form}
          <NodeViewContent className="setu-block-body" />
        </div>
      </NodeViewWrapper>
    )
  }
}

/** The generic folder-block node. `tag` selects the registry entry + (optionally) a React
 *  core; `mdAttrs` is the round-tripped attribute bag (JSON-only, kept out of the DOM like
 *  callout). With a core, the view renders the real visual; otherwise generic chrome. */
export function createSetuBlock(blocks: ResolvedBlock[], cores: Record<string, ComponentType<any>> = {}): Node {
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
      return ReactNodeViewRenderer(viewFor(byTag, cores))
    },
  })
}
