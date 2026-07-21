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
import { NodeSelection } from '@tiptap/pm/state'
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
        extensions={[StarterKit, KeyboardShortcuts]}
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
        extensions={[StarterKit, KeyboardShortcuts, HeroBlock]}
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
        extensions={[StarterKit, KeyboardShortcuts, TaskList, TaskItem]}
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

  it('moves between table cells and keeps focus in the canvas', async () => {
    render(
      <Harness
        extensions={[
          StarterKit,
          KeyboardShortcuts,
          Table.configure({ resizable: false }),
          TableRow,
          TableHeader,
          TableCell
        ]}
        content={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'x' }] }
          ]
        }}
      />
    )
    const editor = testEditor()
    editor
      .chain()
      .focus()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run()
    await expect.element(page.getByRole('table')).toBeInTheDocument()

    // Put real focus in the first header cell.
    await userEvent.click(document.querySelector('th') as HTMLElement)
    expect(document.activeElement).toBe(editorEl())

    const before = editor.state.selection.from
    await userEvent.keyboard('{Tab}')

    expect(document.activeElement).toBe(editorEl())
    expect(editor.state.selection.from).toBeGreaterThan(before)
  })
})
