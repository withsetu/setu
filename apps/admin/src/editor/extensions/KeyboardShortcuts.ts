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
 *  - `cell`: caret in a table → move to the next cell (table cell nav takes
 *    precedence over bubble/indent inside a table).
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

/** Advance to the next table cell; if already in the last cell, append a row and move
 *  into it. Returns true — inside a table Tab always acts, so it is always consumed. */
export function advanceCellOrAddRow(editor: Editor): boolean {
  const moved = editor.chain().focus().goToNextCell().run()
  if (!moved) editor.chain().focus().addRowAfter().goToNextCell().run()
  return true
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
      // Tab: next cell in a table; into the bubble on a text selection; indent in a
      // list. Returns true ONLY when one of those actually happened — returning true
      // unconditionally preventDefault'd Tab even for a no-op, which killed the
      // browser's native focus advance and left the inspector/meta rail with no
      // forward keyboard path at all (#757). We still do the list indent ourselves
      // rather than fall through, because StarterKit declines Tab on a first item.
      Tab: () => {
        const action = tabActionFor(this.editor)
        if (action === 'cell') return advanceCellOrAddRow(this.editor)
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
      // Shift-Tab: previous cell in a table, outdent in a list — consumed ONLY when
      // one of those actually happens. The table branch used to return true whatever
      // `goToPreviousCell` did, and in the FIRST cell it does nothing (there is no
      // previous cell), so Shift-Tab was preventDefault'd and the browser's native
      // backward focus never ran — no keyboard way back out of a table (#783). Tab's
      // "inside a table it always acts" (#757) holds for Tab, which appends a row at
      // the end; Shift-Tab simply has nowhere to go.
      'Shift-Tab': () => {
        if (this.editor.isActive('table'))
          return this.editor.chain().focus().goToPreviousCell().run()
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
