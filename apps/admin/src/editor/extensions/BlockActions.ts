import { Extension } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { moveBlock, startOfChild } from '../block-reorder'

interface TopBlock { index: number; from: number; to: number; node: PMNode }

/** The top-level block targeted by the current selection — works for a text selection
 *  inside a block AND a NodeSelection on a top-level atom (e.g. imageBlock). null if none. */
function topBlock(state: EditorState): TopBlock | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.$from.depth === 0) {
    const node = sel.node
    return { index: sel.$from.index(0), from: sel.from, to: sel.from + node.nodeSize, node }
  }
  const { $from } = sel
  if ($from.depth < 1) return null
  return { index: $from.index(0), from: $from.before(1), to: $from.after(1), node: $from.node(1) }
}

/** Put the caret inside the top-level block now at `index` in the post-move doc.
 *  Computed from the NEW doc (not old-doc neighbor math) so it lands inside the moved
 *  block even when a neighbor is a large container like a callout. */
function selectBlockAt(tr: Transaction, index: number): void {
  const start = startOfChild(tr.doc, index)
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1), 1))
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockActions: {
      moveBlockUp: () => ReturnType
      moveBlockDown: () => ReturnType
      duplicateBlock: () => ReturnType
      deleteBlock: () => ReturnType
    }
  }
}

/** Block-level verbs (operate on the top-level block containing the selection):
 *  move up/down, duplicate, delete. The single source of truth for both the
 *  keyboard shortcuts and the drag-handle menu. */
export const BlockActions = Extension.create({
  name: 'blockActions',

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ state, tr, dispatch }) => {
          const b = topBlock(state)
          if (!b || b.index <= 0) return false
          if (dispatch && moveBlock(state.doc, tr, b.index, b.index - 1)) {
            selectBlockAt(tr, b.index - 1) // moved block now sits at index - 1
          }
          return true
        },

      moveBlockDown:
        () =>
        ({ state, tr, dispatch }) => {
          const b = topBlock(state)
          if (!b || b.index >= state.doc.childCount - 1) return false
          if (dispatch && moveBlock(state.doc, tr, b.index, b.index + 1)) {
            selectBlockAt(tr, b.index + 1) // moved block now sits at index + 1
          }
          return true
        },

      duplicateBlock:
        () =>
        ({ state, chain }) => {
          const b = topBlock(state)
          if (!b) return false
          return chain().insertContentAt(b.to, b.node.toJSON()).run()
        },

      deleteBlock:
        () =>
        ({ state, tr, dispatch }) => {
          const b = topBlock(state)
          if (!b) return false
          if (dispatch) {
            if (state.doc.childCount > 1) {
              tr.delete(b.from, b.to)
            } else {
              tr.replaceWith(b.from, b.to, state.schema.nodes.paragraph!.create())
            }
            const target = Math.min(b.from + 1, tr.doc.content.size)
            tr.setSelection(TextSelection.near(tr.doc.resolve(target)))
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Alt-Shift-ArrowDown': () => this.editor.commands.moveBlockDown(),
      'Alt-Shift-d': () => this.editor.commands.duplicateBlock(),
      'Alt-Shift-Backspace': () => this.editor.commands.deleteBlock(),
    }
  },
})
