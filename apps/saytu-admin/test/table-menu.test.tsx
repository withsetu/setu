import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { tableActions } from '../src/editor/TableMenu'
import { tiptapToMarkdoc } from '@saytu/core'

let editor: Editor
afterEach(() => editor?.destroy())

const alignAttr = {
  align: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.textAlign || null,
    renderHTML: (attrs: { align?: string | null }) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
  },
}
const AlignTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttr } } })
const AlignTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttr } } })

const make = () => {
  const e = new Editor({
    extensions: [StarterKit.configure({ underline: false }), Table.configure({ resizable: false }), TableRow, AlignTableHeader, AlignTableCell],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
  return e
}

describe('tableActions', () => {
  it('adds and deletes columns', () => {
    editor = make()
    const cols = () => (editor.getJSON().content![0]! as any).content[0].content.length
    const before = cols()
    tableActions.addColumnAfter(editor)
    expect(cols()).toBe(before + 1)
    tableActions.deleteColumn(editor)
    expect(cols()).toBe(before)
  })

  it('sets alignment on the whole column (header + body), not just one cell', () => {
    editor = make() // 2x2 with header row, using align-extended cells
    // Place caret reliably inside the LAST body cell (row 1, last column) by walking the doc.
    const { doc } = editor.state
    let bodyRowIndex = -1
    let caret = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow') bodyRowIndex++
      if (bodyRowIndex === 1 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
        // pos+1 lands inside the cell's content (its paragraph). Keep the last (rightmost) cell.
        caret = pos + 1
      }
      return true
    })
    expect(caret).toBeGreaterThan(0)
    editor.commands.setTextSelection(caret)
    expect(editor.isActive('table')).toBe(true)

    tableActions.setColumnAlign(editor, 'right')

    const json = editor.getJSON() as any
    const rows = json.content[0].content // tableRow[]
    const colOf = (rowIdx: number, colIdx: number) => rows[rowIdx].content[colIdx].attrs.align
    const lastCol = rows[0].content.length - 1
    // header (row 0) and body (row 1) of the caret's column should both be 'right'
    expect(colOf(0, lastCol)).toBe('right')
    expect(colOf(1, lastCol)).toBe('right')
    // the other column is untouched
    expect(colOf(0, 0)).toBe(null)
  })

  it('persists body-cell-set alignment through the core round-trip', () => {
    editor = make()
    const { doc } = editor.state
    let bodyRowIndex = -1
    let caret = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow') bodyRowIndex++
      if (bodyRowIndex === 1 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) {
        caret = pos + 1
      }
      return true
    })
    editor.commands.setTextSelection(caret)
    tableActions.setColumnAlign(editor, 'right')
    const md = tiptapToMarkdoc(editor.getJSON() as any)
    expect(md).toContain('--:') // the last column's right-alignment survived to GFM
  })
})
