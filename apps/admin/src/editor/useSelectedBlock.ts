import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { attrString } from './attr-string'

/** Block node types whose props are edited in the inspector rail. (callout/image/contact
 *  keep their own bespoke UI and are intentionally NOT inspector-driven.) */
const INSPECTABLE = new Set([
  'setuBlock',
  'heroBlock',
  'queryBlock',
  'latestPostsBlock'
])

export interface SelectedBlock {
  tag: string
  mdAttrs: Record<string, unknown>
  pos: number
}

function tagOf(name: string, attrs: Record<string, unknown>): string {
  return name === 'setuBlock'
    ? attrString(attrs.tag)
    : name === 'heroBlock'
      ? 'hero'
      : name === 'queryBlock'
        ? 'query'
        : name === 'latestPostsBlock'
          ? 'latest-posts'
          : ''
}

/** Pure: the inspectable block at the current selection, or null. Atom blocks surface via
 *  NodeSelection; body-bearing blocks (setuBlock) via the nearest ancestor of the cursor. */
export function selectedBlockOf(state: EditorState): SelectedBlock | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && INSPECTABLE.has(sel.node.type.name)) {
    return {
      tag: tagOf(sel.node.type.name, sel.node.attrs),
      mdAttrs: (sel.node.attrs.mdAttrs ?? {}) as Record<string, unknown>,
      pos: sel.from
    }
  }
  const { $from } = sel
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d)
    if (INSPECTABLE.has(node.type.name)) {
      return {
        tag: tagOf(node.type.name, node.attrs),
        mdAttrs: (node.attrs.mdAttrs ?? {}) as Record<string, unknown>,
        pos: $from.before(d)
      }
    }
  }
  return null
}

/** Whether two derived selections refer to the same block in the same state. mdAttrs is
 *  compared by reference: ProseMirror reuses a node's attrs object until it actually changes,
 *  so an edit produces a fresh object (≠) while idle transactions keep the same one (=). */
function sameBlock(a: SelectedBlock | null, b: SelectedBlock | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.pos === b.pos && a.tag === b.tag && a.mdAttrs === b.mdAttrs
}

/** React hook: the selected inspectable block + an `update(name,value)` writer. */
export function useSelectedBlock(
  editor: Editor | null
): (SelectedBlock & { update: (name: string, value: unknown) => void }) | null {
  const [sel, setSel] = useState<SelectedBlock | null>(null)
  useEffect(() => {
    if (!editor) {
      setSel(null)
      return
    }
    // Only update state when the selected block actually changes. `transaction` fires on
    // every editor change (incl. focus/IME churn from the inspector's Radix children); without
    // this guard each fire sets a brand-new object → re-render → Radix re-renders → more churn,
    // an unbounded "Maximum update depth exceeded" loop that blanks the editor.
    const sync = () =>
      setSel((prev) => {
        const next = selectedBlockOf(editor.state)
        return sameBlock(prev, next) ? prev : next
      })
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    return () => {
      editor.off('selectionUpdate', sync)
      editor.off('transaction', sync)
    }
  }, [editor])

  if (!sel || !editor) return null
  const update = (name: string, value: unknown) => {
    const node = editor.state.doc.nodeAt(sel.pos)
    if (!node) return
    const next = { ...((node.attrs.mdAttrs ?? {}) as Record<string, unknown>) }
    if (value === '') delete next[name]
    else next[name] = value
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeAttribute(sel.pos, 'mdAttrs', next)
        return true
      })
      .run()
  }
  return { ...sel, update }
}
