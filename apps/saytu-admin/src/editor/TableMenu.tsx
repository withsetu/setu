import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'

export const tableActions = {
  addRowAfter: (e: Editor) => e.chain().focus().addRowAfter().run(),
  addColumnAfter: (e: Editor) => e.chain().focus().addColumnAfter().run(),
  deleteRow: (e: Editor) => e.chain().focus().deleteRow().run(),
  deleteColumn: (e: Editor) => e.chain().focus().deleteColumn().run(),
  deleteTable: (e: Editor) => e.chain().focus().deleteTable().run(),
  setColumnAlign: (e: Editor, align: 'left' | 'center' | 'right' | null) =>
    e.chain().focus().updateAttributes('tableCell', { align }).updateAttributes('tableHeader', { align }).run(),
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
