import type { Editor } from '@tiptap/core'
import { TextAlign } from '@tiptap/extension-text-align'

/** True when the selection sits inside a table cell (body or header). */
export const inTableCell = (editor: Editor): boolean =>
  editor.isActive('tableCell') || editor.isActive('tableHeader')

/** `TextAlign` whose `setTextAlign` / `toggleTextAlign` commands no-op inside a table
 *  cell (#760).
 *
 *  A GFM cell is inline-only, so a per-paragraph `textAlign` there has nowhere to
 *  serialize — `table-gfm`'s `cellToGfm` renders a cell's inline content WITHOUT an
 *  alignment annotation (an `{% align %}` would corrupt the pipe cell). A centred cell
 *  paragraph therefore silently reopened un-centred: set-in-the-editor, dropped-on-save.
 *
 *  Whole-column alignment — `TableMenu`'s `setColumnAlign`, persisted on the cell `align`
 *  attribute and read back from the column separator — is the mechanism that DOES round
 *  trip, so per-cell paragraph align is redundant as well as lossy. Guarding the command
 *  (rather than the schema attribute) also covers the `Mod-Shift-{l,e,r}` shortcuts,
 *  which route through it, and leaves heading/paragraph align untouched everywhere else. */
export const CellAwareTextAlign = TextAlign.extend({
  addCommands() {
    const parent = this.parent?.()
    return {
      ...parent,
      setTextAlign: (alignment: string) => (props) =>
        inTableCell(props.editor)
          ? false
          : (parent?.setTextAlign?.(alignment)(props) ?? false),
      toggleTextAlign: (alignment: string) => (props) =>
        inTableCell(props.editor)
          ? false
          : (parent?.toggleTextAlign?.(alignment)(props) ?? false)
    }
  }
})
