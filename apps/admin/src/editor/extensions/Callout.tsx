import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer
} from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import {
  Callout as CalloutCore,
  BlockIcon,
  variantFor,
  calloutVariants,
  CALLOUT_ICONS,
  isBlockIconName
} from '@setu/blocks'
import type { BlockIconName } from '@setu/blocks'
import { useToolbarRoving } from '../useToolbarRoving'
import { useMirroredField } from '../useMirroredField'
import { attrString } from '../attr-string'

/** If the caret sits at the very start of a callout's body, move keyboard focus
 *  to that callout's title `<input>`. Returns true when it handled the key (so the
 *  caller can preventDefault and stop ProseMirror from acting on the arrow). */
function focusTitleAtBodyStart(editor: Editor): boolean {
  const sel = editor.state.selection
  if (!sel.empty || sel.$from.parentOffset !== 0) return false
  // Walk up to the enclosing callout node and its document position.
  for (let depth = sel.$from.depth; depth >= 0; depth--) {
    const ancestor = sel.$from.node(depth)
    if (ancestor.type.name !== 'callout') continue
    const calloutPos = sel.$from.before(depth)
    // Caret must be in the callout's first child (body start).
    if (sel.from > calloutPos + 2) return false
    const dom = editor.view.nodeDOM(calloutPos)
    const input =
      dom instanceof HTMLElement
        ? dom.querySelector<HTMLInputElement>('.callout-title')
        : null
    if (!input) return false
    input.focus()
    return true
  }
  return false
}

function CalloutView({
  node,
  updateAttributes,
  editor,
  getPos
}: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const type = attrString(mdAttrs['type'], 'info')
  const title = attrString(mdAttrs['title'])
  const variant = variantFor(type)
  const overrideIcon = mdAttrs['icon']
  const icon: BlockIconName =
    typeof overrideIcon === 'string' && isBlockIconName(overrideIcon)
      ? overrideIcon
      : variant.icon

  const setAttrs = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...mdAttrs, ...patch }
    if (next['title'] === '') delete next['title']
    if (next['icon'] === '') delete next['icon']
    updateAttributes({ mdAttrs: next })
  }

  // The title is a free-text input: mirror its value in local state so a clear
  // right after typing is not swallowed by 3.28's deferred node-view re-render (#691).
  const titleField = useMirroredField(title, (v) => setAttrs({ title: v }))

  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()
  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()

  const toolbar = (
    <div
      className="block-props"
      contentEditable={false}
      role="toolbar"
      aria-label="Callout style"
      ref={toolbarRef}
      onKeyDown={(e) => {
        onToolbarKeyDown(e)
        if (e.key === 'Escape') {
          e.preventDefault()
          const pos = getPos()
          if (typeof pos === 'number') {
            editor
              .chain()
              .setTextSelection(pos + 2)
              .run()
            editor.view.focus()
          }
        }
      }}
    >
      <span className="bp-label">Tone</span>
      {calloutVariants().map((v) => (
        <button
          key={v.type}
          type="button"
          className={`bp-swatch tone-${v.tone}${type === v.type ? ' on' : ''}`}
          title={v.label}
          aria-label={v.label}
          data-toolbar-item
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
          data-toolbar-item
          onMouseDown={keepFocus}
          onClick={() => setAttrs({ icon: ic })}
        >
          <BlockIcon name={ic} size={15} />
        </button>
      ))}
    </div>
  )

  const titleInput = (
    <input
      className="callout-title"
      placeholder="Add a title…"
      value={titleField.value}
      onChange={(e) => titleField.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault()
          const pos = getPos()
          if (typeof pos === 'number') {
            editor
              .chain()
              .setTextSelection(pos + 2)
              .run()
            editor.view.focus()
          }
          return
        }
        e.stopPropagation()
      }}
    />
  )

  return (
    <NodeViewWrapper>
      <CalloutCore
        tone={variant.tone}
        icon={icon}
        toolbar={toolbar}
        title={titleInput}
      >
        <NodeViewContent className="callout-body" aria-label="Callout text" />
      </CalloutCore>
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
        parseHTML: () => ({})
      }
    }
  },
  addKeyboardShortcuts() {
    return {
      // ArrowUp at the very start of a callout body lifts focus to its title input.
      ArrowUp: () => focusTitleAtBodyStart(this.editor)
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
  }
})
