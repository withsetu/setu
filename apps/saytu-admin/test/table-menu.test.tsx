import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { tableActions } from '../src/editor/TableMenu'

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

  it('sets column alignment on the cell', () => {
    editor = make()
    tableActions.setColumnAlign(editor, 'center')
    const json = editor.getJSON()
    const cell = (json.content![0]! as any).content[0].content[0]
    expect(cell.attrs.align).toBe('center')
  })
})
