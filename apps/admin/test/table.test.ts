import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  Table,
  TableRow,
  TableHeader,
  TableCell
} from '@tiptap/extension-table'
import { CellAwareTextAlign } from '../src/editor/extensions/CellAwareTextAlign'

let editor: Editor
afterEach(() => editor?.destroy())

const alignAttr = {
  align: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.textAlign || null,
    renderHTML: (attrs: { align?: string | null }) =>
      attrs.align ? { style: `text-align: ${attrs.align}` } : {}
  }
}
const AlignTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttr }
  }
})
const AlignTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttr }
  }
})

describe('table extension', () => {
  it('inserts a table with a header row and supports a cell align attribute', () => {
    editor = new Editor({
      extensions: [
        StarterKit.configure({ underline: false }),
        Table.configure({ resizable: false }),
        TableRow,
        AlignTableHeader,
        AlignTableCell
      ],
      content: { type: 'doc', content: [{ type: 'paragraph' }] }
    })
    editor
      .chain()
      .focus()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run()
    expect(editor.isActive('table')).toBe(true)
    const json = editor.getJSON()
    const firstCell = (json.content as any[])[0].content[0].content[0]
    expect(firstCell.attrs).toHaveProperty('align')
  })
})

describe('CellAwareTextAlign (#760)', () => {
  const makeEditor = (content: Content) =>
    new Editor({
      extensions: [
        StarterKit.configure({ underline: false }),
        Table.configure({ resizable: false }),
        TableRow,
        AlignTableHeader,
        AlignTableCell,
        CellAwareTextAlign.configure({
          types: ['heading', 'paragraph'],
          alignments: ['left', 'center', 'right']
        })
      ],
      content
    })

  it('applies textAlign to a top-level paragraph', () => {
    editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }]
    })
    editor.chain().focus().selectAll().run()
    const applied = editor.commands.setTextAlign('center')
    expect(applied).toBe(true)
    const para = (editor.getJSON().content as any[])[0]
    expect(para.attrs?.textAlign).toBe('center')
  })

  it('does NOT apply textAlign to a cell-nested paragraph (redundant + lossy)', () => {
    editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] })
    editor
      .chain()
      .focus()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run()
    // Caret lands in the first (header) cell after insertTable; move into a body cell
    // and confirm the guard fires there too.
    editor.chain().focus().goToNextCell().goToNextCell().run()
    expect(editor.isActive('tableCell')).toBe(true)

    const applied = editor.commands.setTextAlign('center')
    expect(applied).toBe(false)

    // No paragraph anywhere in the table carries a non-null textAlign.
    const aligns: unknown[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph')
        aligns.push(node.attrs.textAlign ?? null)
    })
    expect(aligns.every((a) => a === null)).toBe(true)
  })
})
