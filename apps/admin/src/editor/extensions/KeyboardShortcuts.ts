import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import {
  requestLinkEdit,
  requestShortcuts,
  requestFocusToolbar
} from '../editor-events'
import { collapseSelectionOnEscape } from '../dismiss'

/** What Tab should do in the editor body. Tab is consumed ONLY where it actually does
 *  something; anything else falls through to the browser's native focus advance, so the
 *  block-inspector / meta-panel rail after the canvas has a forward keyboard path (#757):
 *  - `cell`: caret in a table → we do NOTHING and decline, letting
 *    @tiptap/extension-table's own Tab/Shift-Tab keymap act (#799). The branch still
 *    exists so a text selection inside a cell can't be claimed by `bubble` first —
 *    test-browser/editor-tab-focus.test.tsx "lets cell navigation win over the format
 *    bubble for a selection inside a cell" is what enforces that ordering.
 *  - `bubble`: a non-empty TEXT selection is showing the format bubble → move focus into
 *    it. Restricted to a TextSelection because that is exactly what FormatBubble renders
 *    for: a NodeSelection on an atom is "non-empty" too, and used to consume Tab while
 *    focusing nothing at all — the worst case, since an atom's only editing UI IS the rail.
 *  - `indent`: caret in a list → sink the list item. Whether it is consumed depends on
 *    whether the sink lands: on a first/un-sinkable item nothing happens, so Tab falls
 *    through rather than dying silently.
 *  - `escape`: caret elsewhere → let the browser move focus. Pure. */
export function tabActionFor(
  editor: Editor
): 'cell' | 'bubble' | 'indent' | 'escape' {
  if (editor.isActive('table')) return 'cell'
  const { selection } = editor.state
  if (selection instanceof TextSelection && !selection.empty) return 'bubble'
  if (editor.isActive('listItem') || editor.isActive('taskItem'))
    return 'indent'
  return 'escape'
}

/** Editor-level custom keymaps that need app coordination (the mark/block-move
 *  shortcuts live in StarterKit/BlockActions). Mod-k opens the link editor for a
 *  non-empty selection; Mod-/ opens the shortcuts cheat sheet. */
export const KeyboardShortcuts = Extension.create({
  name: 'setuKeyboardShortcuts',
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
      // Tab: into the bubble on a text selection; indent in a list. Returns true ONLY
      // when one of those actually happened — returning true unconditionally
      // preventDefault'd Tab even for a no-op, which killed the browser's native focus
      // advance and left the inspector/meta rail with no forward keyboard path at all
      // (#757). We still do the list indent ourselves rather than fall through, because
      // StarterKit declines Tab on a first item.
      //
      // Tables are the table extension's job (#799): it ships the same
      // next-cell/append-row behaviour we had duplicated, plus the
      // `if (!can().addRowAfter()) return false` guard we had dropped — without which
      // Tab was consumed for a no-op wherever a row can't be appended, re-creating the
      // very #757 trap above. Declining here hands it over (this extension is declared
      // LAST in Canvas.tsx, so its keymap runs first).
      Tab: () => {
        const action = tabActionFor(this.editor)
        if (action === 'cell') return false
        if (action === 'bubble') {
          requestFocusToolbar()
          return true
        }
        if (action === 'indent') {
          const itemType = this.editor.isActive('taskItem')
            ? 'taskItem'
            : 'listItem'
          return this.editor.chain().focus().sinkListItem(itemType).run()
        }
        return false
      },
      // Shift-Tab: outdent in a list — consumed ONLY when that actually happens.
      // Tables are the table extension's job here too (#799); its `Shift-Tab` is
      // `goToPreviousCell()`, which is exactly what this branch had duplicated, and it
      // already returns false in the FIRST cell so the browser's native backward focus
      // runs (#783 — enforced by test-browser/editor-tab-focus.test.tsx "moves focus
      // backward out of the canvas from the first cell").
      'Shift-Tab': () => {
        if (this.editor.isActive('taskItem'))
          return this.editor.chain().focus().liftListItem('taskItem').run()
        if (this.editor.isActive('listItem'))
          return this.editor.chain().focus().liftListItem('listItem').run()
        return false
      },
      Escape: () => collapseSelectionOnEscape(this.editor)
    }
  }
})
