import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { selectedRect } from '@tiptap/pm/tables'

export const tableActions = {
  addRowAfter: (e: Editor) => e.chain().focus().addRowAfter().run(),
  addColumnAfter: (e: Editor) => e.chain().focus().addColumnAfter().run(),
  deleteRow: (e: Editor) => e.chain().focus().deleteRow().run(),
  deleteColumn: (e: Editor) => e.chain().focus().deleteColumn().run(),
  deleteTable: (e: Editor) => e.chain().focus().deleteTable().run(),
  // Set `align` on EVERY cell in the caret's column (header + all body cells). The GFM
  // serializer reads each column's alignment from the HEADER row, so updating only the
  // caret's cell would lose the alignment on round-trip when the caret is in a body cell.
  setColumnAlign: (e: Editor, align: 'left' | 'center' | 'right' | null) =>
    e
      .chain()
      .focus()
      .command(({ tr, state, dispatch }) => {
        if (!e.isActive('table')) return false
        const rect = selectedRect(state)
        const col = rect.left // column index of the caret's cell (left edge)
        const positions = rect.map.cellsInRect({ left: col, right: col + 1, top: 0, bottom: rect.map.height })
        if (dispatch) {
          for (const rel of positions) {
            const pos = rect.tableStart + rel
            const node = tr.doc.nodeAt(pos)
            if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
          }
        }
        return true
      })
      .run(),
}

/** Floating menu for table cell actions. Uses a DISTINCT pluginKey so it coexists
 *  with FormatBubble's default-key BubbleMenu. */
export function TableMenu({ editor }: { editor: Editor }) {
  const A = tableActions
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={({ editor }) => editor.isActive('table')}
      options={{ placement: 'top' }}
    >
      <div className="table-menu" role="toolbar" aria-label="Table actions">
        <button type="button" onClick={() => A.addRowAfter(editor)} title="Add row">+ Row</button>
        <button type="button" onClick={() => A.addColumnAfter(editor)} title="Add column">+ Col</button>
        <button type="button" onClick={() => A.setColumnAlign(editor, 'left')} title="Align left" aria-label="Align left">L</button>
        <button type="button" onClick={() => A.setColumnAlign(editor, 'center')} title="Align center" aria-label="Align center">C</button>
        <button type="button" onClick={() => A.setColumnAlign(editor, 'right')} title="Align right" aria-label="Align right">R</button>
        <button type="button" onClick={() => A.deleteRow(editor)} title="Delete row">− Row</button>
        <button type="button" onClick={() => A.deleteColumn(editor)} title="Delete column">− Col</button>
        <button type="button" onClick={() => A.deleteTable(editor)} title="Delete table">Delete</button>
      </div>
    </BubbleMenu>
  )
}
