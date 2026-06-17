import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { requestLinkEdit, requestShortcuts, requestFocusToolbar } from '../editor-events'
import { collapseSelectionOnEscape } from '../dismiss'

/** What Tab should do in the editor body. Tab is ALWAYS consumed (never allowed to
 *  escape the contenteditable to embedded inputs like a callout title):
 *  - `bubble`: a non-empty text selection is showing the format bubble → move focus into it.
 *  - `indent`: caret in a list → sink the list item (a no-op on a first/top item, but
 *    still consumed — so it never escapes).
 *  - `consume`: caret elsewhere → swallow Tab (no-op). Pure. */
export function tabActionFor(editor: Editor): 'bubble' | 'indent' | 'consume' {
  if (!editor.state.selection.empty) return 'bubble'
  if (editor.isActive('listItem') || editor.isActive('taskItem')) return 'indent'
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
      // Tab: into the bubble on a selection; indent in a list; otherwise consume.
      // ALWAYS returns true so focus never escapes the editor to embedded inputs
      // (e.g. a callout title). We do the list indent ourselves rather than fall
      // through, because StarterKit declines Tab on a first/un-sinkable item.
      Tab: () => {
        const action = tabActionFor(this.editor)
        if (action === 'bubble') requestFocusToolbar()
        else if (action === 'indent') {
          const itemType = this.editor.isActive('taskItem') ? 'taskItem' : 'listItem'
          this.editor.chain().focus().sinkListItem(itemType).run()
        }
        return true
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('taskItem')) return this.editor.chain().focus().liftListItem('taskItem').run()
        if (this.editor.isActive('listItem')) return this.editor.chain().focus().liftListItem('listItem').run()
        return false
      },
      Escape: () => collapseSelectionOnEscape(this.editor),
    }
  },
})
