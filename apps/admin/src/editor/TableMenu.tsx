import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { selectedRect } from '@tiptap/pm/tables'
import { Icon } from '../ui/Icon'

export const tableActions = {
  addRowAfter: (e: Editor) => e.chain().focus().addRowAfter().run(),
  addColumnAfter: (e: Editor) => e.chain().focus().addColumnAfter().run(),
  deleteRow: (e: Editor) => e.chain().focus().deleteRow().run(),
  deleteColumn: (e: Editor) => e.chain().focus().deleteColumn().run(),
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
        const positions = rect.map.cellsInRect({
          left: col,
          right: col + 1,
          top: 0,
          bottom: rect.map.height
        })
        if (dispatch) {
          for (const rel of positions) {
            const pos = rect.tableStart + rel
            const node = tr.doc.nodeAt(pos)
            if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
          }
        }
        return true
      })
      .run()
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
        <button
          type="button"
          onClick={() => A.setColumnAlign(editor, 'left')}
          title="Align column left"
          aria-label="Align column left"
        >
          <Icon name="alignLeft" size={16} />
        </button>
        <button
          type="button"
          onClick={() => A.setColumnAlign(editor, 'center')}
          title="Align column center"
          aria-label="Align column center"
        >
          <Icon name="alignCenter" size={16} />
        </button>
        <button
          type="button"
          onClick={() => A.setColumnAlign(editor, 'right')}
          title="Align column right"
          aria-label="Align column right"
        >
          <Icon name="alignRight" size={16} />
        </button>
        <button
          type="button"
          onClick={() => A.addRowAfter(editor)}
          title="Add row below"
          aria-label="Add row below"
        >
          <Icon name="rowAdd" size={16} />
        </button>
        <button
          type="button"
          onClick={() => A.deleteRow(editor)}
          title="Delete row"
          aria-label="Delete row"
        >
          <Icon name="rowDelete" size={16} />
        </button>
        <button
          type="button"
          onClick={() => A.addColumnAfter(editor)}
          title="Add column right"
          aria-label="Add column right"
        >
          <Icon name="columnAdd" size={16} />
        </button>
        <button
          type="button"
          onClick={() => A.deleteColumn(editor)}
          title="Delete column"
          aria-label="Delete column"
        >
          <Icon name="columnDelete" size={16} />
        </button>
      </div>
    </BubbleMenu>
  )
}
