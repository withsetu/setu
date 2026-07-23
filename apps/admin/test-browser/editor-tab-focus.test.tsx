import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import {
  Table,
  TableRow,
  TableHeader,
  TableCell
} from '@tiptap/extension-table'
import type { Editor, Extensions, JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { KeyboardShortcuts } from '../src/editor/extensions/KeyboardShortcuts'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'

// ---------------------------------------------------------------------------------
// #757 — Tab must not be a one-way focus trap. The editor's Tab handler used to return
// true in EVERY branch, so ProseMirror preventDefault'd Tab even when nothing had been
// done with it, and the browser's native focus advance never ran: the block-inspector /
// meta-panel rail that renders after the canvas had NO forward keyboard path.
//
// This is the jsdom-blind class (CLAUDE.md §4 #3): jsdom implements neither native tab
// order nor real focus, so only a real browser can prove where focus actually goes.
// The two halves are equally load-bearing — Tab must fall through when it does nothing,
// AND must still be consumed by the cases that genuinely act on it (list indent, table
// cell nav), which is the behaviour the always-consume was protecting.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

/** Tiptap reverses the extension list before building keymap plugins
 *  (`[...this.extensions].reverse()` in ExtensionManager's `get plugins()`,
 *  @tiptap/core 3.28.0), so a LATER-declared extension's Tab handler runs FIRST.
 *
 *  What matters is a RELATION, not an absolute position: `KeyboardShortcuts` is
 *  declared after `Table`/`TableRow` in Canvas.tsx. It is NOT last there — `dragHandle`,
 *  the block extensions, `SlashCommand` and `LinkTools` all follow it — and an earlier
 *  version of this comment said "LAST", which was simply wrong. Harnesses below must
 *  preserve the after-Table relation; the helper name is historical.
 *
 *  Nothing automatically enforces this — that is the point of writing it down. Get the
 *  order wrong and the tests still PASS while measuring @tiptap/extension-table's
 *  keymap instead of ours, which is exactly how #757's table test kept passing with our
 *  handler deleted (#799). When adding a harness here, verify by deleting the behaviour
 *  under test and confirming your test fails. */
const withShortcutsLast = (extensions: Extensions): Extensions => [
  ...extensions,
  KeyboardShortcuts
]

/** Title input before the canvas, rail button after it — the real EditorScreen tab
 *  order (ed-title → ProseMirror → BlockInspector/MetaPanel aside) in miniature. */
function Harness({
  extensions,
  content
}: {
  extensions: Extensions
  content: JSONContent
}) {
  const editor = useEditor({ immediatelyRender: false, extensions, content })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return (
    <div>
      <input className="ed-title" aria-label="Title" />
      <EditorContent editor={editor} />
      <aside>
        <button type="button">Rail control</button>
      </aside>
    </div>
  )
}

const editorEl = () => document.querySelector('.ProseMirror') as HTMLElement
const testEditor = () => {
  const editor = (window as unknown as { __setuTestEditor?: Editor })
    .__setuTestEditor
  if (!editor) throw new Error('test editor was not exposed on window')
  return editor
}

describe('#757 Tab falls through when the editor does not act on it', () => {
  it('moves focus out of the canvas to the next control at a plain caret', async () => {
    render(
      <Harness
        extensions={withShortcutsLast([StarterKit])}
        content={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
          ]
        }}
      />
    )
    // Click the real prose — the path a user takes, and the only reliable way to
    // put real browser focus in the contenteditable.
    await userEvent.click(page.getByText('hello'))
    expect(document.activeElement).toBe(editorEl())

    await userEvent.keyboard('{Tab}')

    expect(document.activeElement).not.toBe(editorEl())
    expect((document.activeElement as HTMLElement)?.textContent).toBe(
      'Rail control'
    )
  })

  it('moves focus to the rail when an atom block is node-selected', async () => {
    render(
      <Harness
        extensions={withShortcutsLast([StarterKit, HeroBlock])}
        content={{
          type: 'doc',
          content: [
            { type: 'paragraph' },
            {
              type: 'heroBlock',
              attrs: { mdAttrs: { headline: 'Selected hero' } }
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Selected hero' }))
      .toBeInTheDocument()

    const editor = testEditor()
    await userEvent.click(page.getByRole('heading', { name: 'Selected hero' }))
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))
    )
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(document.activeElement).toBe(editorEl())

    await userEvent.keyboard('{Tab}')

    // A NodeSelection is "non-empty" but the format bubble only shows for a
    // TextSelection, so the old `bubble` branch consumed Tab and focused nothing.
    expect((document.activeElement as HTMLElement)?.textContent).toBe(
      'Rail control'
    )
  })
})

describe('#757 Tab is still consumed by the cases that act on it', () => {
  it('indents a list item and keeps focus in the canvas', async () => {
    render(
      <Harness
        extensions={withShortcutsLast([StarterKit, TaskList, TaskItem])}
        content={{
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'first' }]
                    }
                  ]
                },
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'second' }]
                    }
                  ]
                }
              ]
            }
          ]
        }}
      />
    )
    await expect.element(page.getByText('second')).toBeInTheDocument()

    // Caret inside the SECOND item — a first item cannot be sunk.
    await userEvent.click(page.getByText('second'))
    expect(document.activeElement).toBe(editorEl())

    await userEvent.keyboard('{Tab}')

    // The item nested (a nested bulletList now lives inside the first item) and
    // focus stayed in the editor.
    expect(document.activeElement).toBe(editorEl())
    expect(
      editorEl().querySelectorAll('ul ul li').length
    ).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------------
// #783 — the sibling #757 left behind. The Shift-Tab table branch ran
// `goToPreviousCell()` and returned true regardless of whether it moved, so in the
// FIRST cell (where prosemirror-tables has nowhere to go) ProseMirror still
// preventDefault'd and the browser's native backward focus never ran: a keyboard user
// could not get out of a table backwards. The asymmetry that hid it — #757's "inside a
// table Tab always acts" is true for Tab (it appends a row) and false for Shift-Tab.
// ---------------------------------------------------------------------------------

/** Caret positions inside each table cell, in document order. Derived from the doc
 *  rather than from a click: an empty cell is a few pixels tall, and clicking one
 *  lands the caret wherever the browser's hit-test decides (it lands in row 2 here) —
 *  which cell the caret is in is the whole point of this pair of tests. */
function cellCaretPositions(editor: Editor): number[] {
  const positions: number[] = []
  editor.state.doc.descendants((node, pos) => {
    const name = node.type.name
    if (name === 'tableHeader' || name === 'tableCell') positions.push(pos + 2)
    return true
  })
  return positions
}

/** Editor with a 2×2 table, real browser focus in the canvas and the caret in the
 *  cell `pick` chooses. */
async function renderTableAt(
  pick: (caretPositions: number[]) => number
): Promise<Editor> {
  render(
    <Harness
      extensions={withShortcutsLast([
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell
      ])}
      content={{
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]
      }}
    />
  )
  const editor = testEditor()
  editor.chain().focus().insertTable({ rows: 2, cols: 2 }).run()
  await expect.element(page.getByRole('table')).toBeInTheDocument()
  // Click into the canvas for real browser focus, then place the caret exactly.
  await userEvent.click(editorEl().querySelector('th') as HTMLElement)
  editor.commands.setTextSelection(pick(cellCaretPositions(editor)))
  expect(document.activeElement).toBe(editorEl())
  expect(editor.isActive('table')).toBe(true)
  return editor
}

describe('#783 Shift-Tab falls through in the first table cell', () => {
  it('moves focus backward out of the canvas from the first cell', async () => {
    const editor = await renderTableAt((cells) => cells[0]!)
    const before = editor.state.selection.from

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    // Nothing to move to inside the table → the browser's backward focus must run.
    expect(editor.state.selection.from).toBe(before)
    expect(document.activeElement).not.toBe(editorEl())
    expect((document.activeElement as HTMLInputElement)?.className).toContain(
      'ed-title'
    )
  })

  it('still moves to the previous cell from a later cell', async () => {
    const editor = await renderTableAt((cells) => cells[1]!)
    const before = editor.state.selection.from

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    expect(document.activeElement).toBe(editorEl())
    expect(editor.state.selection.from).toBeLessThan(before)
  })
})

// ---------------------------------------------------------------------------------
// #799 — Tab inside a table. Setu's Tab handler used to re-implement
// @tiptap/extension-table's own keymap, minus its `if (!can().addRowAfter()) return
// false` guard: it hard-returned true, so wherever a row could not be appended Tab was
// consumed for a no-op — the #757 focus trap, rebuilt. Those branches are deleted; the
// only Setu behaviour left in a table is DECLINING (`tabActionFor` still classifies a
// table caret as 'cell' so the format-bubble branch cannot claim Tab first), after
// which the table extension acts. The old test for this could not fail: it asserted
// only that the caret moved forward, which the library does on its own.
// ---------------------------------------------------------------------------------

/** Which cell (0-based, document order) the caret sits in. */
function cellIndexOf(editor: Editor): number {
  const cells = cellCaretPositions(editor)
  const at = editor.state.selection.from
  return cells.filter((p) => p <= at).length - 1
}

describe('#799 Tab in a table is handled by the table extension, not by us', () => {
  it('moves from the first cell to the second, keeping focus in the canvas', async () => {
    const editor = await renderTableAt((cells) => cells[0]!)
    expect(cellIndexOf(editor)).toBe(0)

    await userEvent.keyboard('{Tab}')

    expect(document.activeElement).toBe(editorEl())
    expect(cellIndexOf(editor)).toBe(1)
  })

  it('appends a row from the last cell and lands the caret in it', async () => {
    const editor = await renderTableAt((cells) => cells[cells.length - 1]!)
    const rowCount = () => editorEl().querySelectorAll('tr').length
    const before = rowCount()
    expect(cellIndexOf(editor)).toBe(cellCaretPositions(editor).length - 1)

    await userEvent.keyboard('{Tab}')

    expect(document.activeElement).toBe(editorEl())
    expect(rowCount()).toBe(before + 1)
    // First cell of the appended row — the last cell of the old table + 1.
    expect(cellIndexOf(editor)).toBe(before * 2)
  })

  it('lets cell navigation win over the format bubble for a selection inside a cell', async () => {
    const editor = await renderTableAt((cells) => cells[0]!)
    editor.commands.insertContent('abc')
    const from = cellCaretPositions(editor)[0]!
    editor.commands.setTextSelection({ from, to: from + 3 })
    // Precondition: this is exactly the shape the 'bubble' branch fires on, so a
    // table caret MUST be classified before it.
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.empty).toBe(false)

    await userEvent.keyboard('{Tab}')

    expect(document.activeElement).toBe(editorEl())
    expect(cellIndexOf(editor)).toBe(1)
  })
})
