import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'
import { Columns, Column } from '../src/editor/extensions/Columns'
import { Callout } from '../src/editor/extensions/Callout'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'
// The real block stylesheet — the grid-paint assertion below tests the actual CSS
// the canvas (and site) load, not a test-local imitation.
import '@setu/blocks/columns.css'

// ---------------------------------------------------------------------------------
// Columns (#181) — the first MULTI-SLOT nested container (Shape B, #121). Real-browser
// coverage because the container is a bespoke nested-ProseMirror schema (jsdom's
// contenteditable/selection handling lies for exactly this class): the grid must
// paint from the node's derived classes, typing must land in the right slot, and
// setColumnsLayout must reconcile the column count without ever dropping content.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

const column = (...blocks: JSONContent[]): JSONContent => ({
  type: 'column',
  content: blocks.length ? blocks : [{ type: 'paragraph' }]
})

const p = (text?: string): JSONContent => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : []
})

let currentEditor: Editor | null = null

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Callout, Columns, Column],
    content,
    editorProps: {
      attributes: { class: 'setu-prose', 'aria-label': 'Content editor' }
    }
  })
  currentEditor = editor
  return <EditorContent editor={editor} />
}

const twoColumns = (
  mdAttrs: Record<string, unknown> = { layout: '50-50' }
) => ({
  type: 'doc',
  content: [
    {
      type: 'columns',
      attrs: { mdAttrs },
      content: [column(p('Left')), column(p('Right'))]
    }
  ]
})

const columnsEl = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-columns]')

describe('Columns node (real browser)', () => {
  it('renders the shared site classes and grid-template from mdAttrs', async () => {
    render(
      <Harness
        content={twoColumns({
          layout: '33-67',
          gap: 'lg',
          stackOnMobile: false
        })}
      />
    )
    await expect.element(page.getByText('Left')).toBeInTheDocument()
    const el = columnsEl()!
    expect(el.className).toContain('blk-columns')
    expect(el.className).toContain('gap-lg')
    expect(el.className).not.toContain('stack')
    expect(el.style.getPropertyValue('--blk-columns-template')).toBe(
      '33fr 67fr'
    )
    // The grid actually paints: two column boxes side by side.
    const cols = el.querySelectorAll('[data-column]')
    expect(cols.length).toBe(2)
    const [a, b] = [...cols].map((c) => c.getBoundingClientRect())
    expect(getComputedStyle(el).display).toBe('grid')
    expect(b!.left).toBeGreaterThan(a!.right - 1)
  })

  it('typing lands in the clicked column only', async () => {
    render(<Harness content={twoColumns()} />)
    await expect.element(page.getByText('Right')).toBeInTheDocument()
    await page.getByText('Right').click()
    await userEvent.keyboard(' side')
    const cols = document.querySelectorAll('[data-column]')
    expect(cols[0]!.textContent).toBe('Left')
    expect(cols[1]!.textContent).toBe('Right side')
  })

  it('the selection inside a column resolves to the columns block (inspector target)', async () => {
    render(<Harness content={twoColumns()} />)
    await expect.element(page.getByText('Left')).toBeInTheDocument()
    await page.getByText('Left').click()
    const sel = selectedBlockOf(currentEditor!.state)
    expect(sel?.tag).toBe('columns')
    expect(sel?.mdAttrs).toEqual({ layout: '50-50' })
  })

  it('setColumnsLayout grows 2 → 3 with an empty editable column', async () => {
    render(<Harness content={twoColumns()} />)
    await expect.element(page.getByText('Left')).toBeInTheDocument()
    currentEditor!.commands.setColumnsLayout(0, '33-33-33')
    const node = currentEditor!.state.doc.child(0)
    expect(node.childCount).toBe(3)
    expect((node.attrs.mdAttrs as Record<string, unknown>).layout).toBe(
      '33-33-33'
    )
    // Third slot exists in the DOM and starts empty.
    const cols = document.querySelectorAll('[data-column]')
    expect(cols.length).toBe(3)
    expect(cols[2]!.textContent).toBe('')
  })

  it('setColumnsLayout shrinks 3 → 2 moving trailing content, never dropping it', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            {
              type: 'columns',
              attrs: { mdAttrs: { layout: '33-33-33' } },
              content: [column(p('One')), column(p('Two')), column(p('Three'))]
            }
          ]
        }}
      />
    )
    await expect.element(page.getByText('Three')).toBeInTheDocument()
    currentEditor!.commands.setColumnsLayout(0, '50-50')
    const node = currentEditor!.state.doc.child(0)
    expect(node.childCount).toBe(2)
    // Column three's paragraph moved into column two.
    const cols = document.querySelectorAll('[data-column]')
    expect(cols.length).toBe(2)
    expect(cols[0]!.textContent).toBe('One')
    expect(cols[1]!.textContent).toBe('TwoThree')
  })

  it('shrinking drops trailing columns that are empty without side effects', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            {
              type: 'columns',
              attrs: { mdAttrs: { layout: '33-33-33' } },
              content: [column(p('One')), column(p('Two')), column()]
            }
          ]
        }}
      />
    )
    await expect.element(page.getByText('Two')).toBeInTheDocument()
    currentEditor!.commands.setColumnsLayout(0, '50-50')
    const cols = document.querySelectorAll('[data-column]')
    expect(cols.length).toBe(2)
    expect(cols[1]!.textContent).toBe('Two')
  })

  it('nests a callout inside a column and keeps its editable body', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            {
              type: 'columns',
              attrs: { mdAttrs: { layout: '50-50' } },
              content: [
                column({
                  type: 'callout',
                  attrs: { mdAttrs: { type: 'info' } },
                  content: [p('Inside note')]
                }),
                column(p('Plain'))
              ]
            }
          ]
        }}
      />
    )
    await expect.element(page.getByText('Inside note')).toBeInTheDocument()
    // The callout node view (React) mounted inside the first column slot.
    const first = document.querySelector('[data-column]')!
    expect(first.querySelector('.blk-callout')).not.toBeNull()
    await page.getByText('Inside note').click()
    await userEvent.keyboard('s grow')
    expect(first.textContent).toContain('Inside notes grow')
  })

  it('backspace at the start of a column does not merge columns (isolating)', async () => {
    render(<Harness content={twoColumns()} />)
    await expect.element(page.getByText('Right')).toBeInTheDocument()
    // Put the caret at the very start of the second column's paragraph.
    const doc = currentEditor!.state.doc
    const columns = doc.child(0)
    // columns opens at 0 so its content starts at 1; the second column starts after
    // the first column's nodeSize; +2 steps past <column><paragraph> to the text.
    const secondColStart = 1 + columns.child(0).nodeSize
    currentEditor!.commands.setTextSelection(secondColStart + 2)
    currentEditor!.commands.focus()
    await userEvent.keyboard('{Backspace}')
    const after = currentEditor!.state.doc.child(0)
    expect(after.childCount).toBe(2)
    expect(after.child(0).textContent).toBe('Left')
    expect(after.child(1).textContent).toBe('Right')
  })
})
