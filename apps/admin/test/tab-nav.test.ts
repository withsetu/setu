import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import {
  Table,
  TableRow,
  TableHeader,
  TableCell
} from '@tiptap/extension-table'
import {
  tabActionFor,
  advanceCellOrAddRow
} from '../src/editor/extensions/KeyboardShortcuts'

let editor: Editor
afterEach(() => editor?.destroy())

const make = () =>
  new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false })
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
      ]
    }
  })

const makeTasks = () =>
  new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      TaskList,
      TaskItem.configure({ nested: true })
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'task' }] }
      ]
    }
  })

/** A doc whose first node is a selectable atom — the shape a NodeSelection lands on
 *  (gallery/hero/video in the app; a horizontal rule is the StarterKit stand-in). */
const makeAtom = () =>
  new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false })
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }
      ]
    }
  })

const makeTable = () => {
  const e = new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell
    ],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]
    }
  })
  e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
  return e
}

// Tab's intent, restated at #757: it is consumed where it ACTS (table cell nav, the
// format bubble, a list indent) and falls through where it does not, so the browser's
// native focus advance can reach the inspector / meta rail after the canvas. The
// previous intent — "always consumed so focus does not escape the editor" — made the
// canvas a one-way forward focus trap and is the defect this suite now guards against.
// Where focus actually LANDS is a real-browser question: test-browser/editor-tab-focus.
describe('tabActionFor', () => {
  it("returns 'cell' when the caret is inside a table", () => {
    editor = makeTable()
    // caret is inside the table after insertTable
    expect(tabActionFor(editor)).toBe('cell')
  })
  it('goes to the bubble for a non-empty TEXT selection', () => {
    editor = make()
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(tabActionFor(editor)).toBe('bubble')
  })
  it('falls through at a plain empty caret (so focus can reach the rail)', () => {
    editor = make()
    editor.commands.setTextSelection(3)
    expect(tabActionFor(editor)).toBe('escape')
  })
  it('falls through on a node selection — the format bubble does not render for one', () => {
    editor = makeAtom()
    editor.commands.setNodeSelection(0)
    expect(editor.state.selection.empty).toBe(false)
    expect(tabActionFor(editor)).toBe('escape')
  })
  it('indents inside a list', () => {
    editor = make()
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBulletList().run()
    editor.commands.setTextSelection(3)
    expect(tabActionFor(editor)).toBe('indent')
  })
  it('indents inside a task list', () => {
    editor = makeTasks()
    editor.chain().setTextSelection({ from: 1, to: 5 }).toggleTaskList().run()
    editor.commands.setTextSelection(3)
    expect(tabActionFor(editor)).toBe('indent')
  })
})

describe('advanceCellOrAddRow', () => {
  it('adds a new row when advancing past the last cell', () => {
    editor = makeTable()
    const rowCount = () => (editor.getJSON() as any).content[0].content.length
    const cells = rowCount() * 2 // 2 cols
    // advance through every existing cell, then once more past the last → should add a row
    for (let i = 0; i < cells; i++) advanceCellOrAddRow(editor)
    expect(rowCount()).toBe(3) // started 2 rows, last-cell advance appended one
  })
})
