import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { moveBlock, startOfChild } from '../block-reorder'

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
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const index = $from.index(0)
          if (index <= 0) return false
          if (dispatch && moveBlock(state.doc, tr, index, index - 1)) {
            selectBlockAt(tr, index - 1) // moved block now sits at index - 1
          }
          return true
        },

      moveBlockDown:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const index = $from.index(0)
          if (index >= state.doc.childCount - 1) return false
          if (dispatch && moveBlock(state.doc, tr, index, index + 1)) {
            selectBlockAt(tr, index + 1) // moved block now sits at index + 1
          }
          return true
        },

      duplicateBlock:
        () =>
        ({ state, chain }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const after = $from.after(1)
          const node = $from.node(1)
          return chain().insertContentAt(after, node.toJSON()).run()
        },

      deleteBlock:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const from = $from.before(1)
          const to = $from.after(1)
          if (dispatch) {
            if (state.doc.childCount > 1) {
              tr.delete(from, to)
            } else {
              tr.replaceWith(from, to, state.schema.nodes.paragraph!.create())
            }
            const target = Math.min(from + 1, tr.doc.content.size)
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
    }
  },
})
