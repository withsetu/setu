import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'

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

describe('table extension', () => {
  it('inserts a table with a header row and supports a cell align attribute', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ underline: false }), Table.configure({ resizable: false }), TableRow, AlignTableHeader, AlignTableCell],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
    expect(editor.isActive('table')).toBe(true)
    const json = editor.getJSON()
    const firstCell = (json.content as any[])[0].content[0].content[0]
    expect(firstCell.attrs).toHaveProperty('align')
  })
})
