import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { requestLinkEdit, requestShortcuts, requestFocusToolbar } from '../editor-events'
import { collapseSelectionOnEscape } from '../dismiss'

/** What Tab should do in the editor body:
 *  - `bubble`: a non-empty text selection is showing the format bubble → move focus into it.
 *  - `fallthrough`: caret in a list → let StarterKit handle it (indent / sink list item).
 *  - `consume`: caret elsewhere → swallow Tab so focus doesn't escape the contenteditable
 *    to embedded inputs (e.g. a callout's title field). Pure. */
export function tabActionFor(editor: Editor): 'bubble' | 'fallthrough' | 'consume' {
  if (!editor.state.selection.empty) return 'bubble'
  if (editor.isActive('listItem')) return 'fallthrough'
  return 'consume'
}

/** Editor-level custom keymaps that need app coordination (the mark/block-move
 *  shortcuts live in StarterKit/BlockActions). Mod-k opens the link editor for a
 *  non-empty selection; Mod-/ opens the shortcuts cheat sheet. */
export const KeyboardShortcuts = Extension.create({
  name: 'saytuKeyboardShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (this.editor.state.selection.empty) return false
        requestLinkEdit()
        return true
      },
      'Mod-/': () => {
        requestShortcuts()
        return true
      },
      // Tab: into the bubble on a selection; indent in a list; otherwise consume so
      // focus doesn't escape the editor to embedded inputs (e.g. a callout title).
      Tab: () => {
        const action = tabActionFor(this.editor)
        if (action === 'fallthrough') return false
        if (action === 'bubble') requestFocusToolbar()
        return true
      },
      Escape: () => collapseSelectionOnEscape(this.editor),
    }
  },
})
