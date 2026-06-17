import { Extension } from '@tiptap/core'
import { requestLinkEdit, requestShortcuts, requestFocusToolbar } from '../editor-events'
import { collapseSelectionOnEscape } from '../dismiss'

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
      // Tab on a non-empty text selection moves focus INTO the format bubble (its
      // toolbar is showing); a collapsed caret falls through (list indent / default).
      Tab: () => {
        if (this.editor.state.selection.empty) return false
        requestFocusToolbar()
        return true
      },
      Escape: () => collapseSelectionOnEscape(this.editor),
    }
  },
})
