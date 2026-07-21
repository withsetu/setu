import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextAlign } from '@tiptap/extension-text-align'
import type { Editor } from '@tiptap/core'
import { FormatBubble } from '../src/editor/FormatBubble'

// ---------------------------------------------------------------------------------
// #758. FormatBubble wraps a PORTALLED BubbleMenu with a document-level Esc listener
// and focus retention (onMouseDown preventDefault). The Esc/focus hand-off spans
// FormatBubble ↔ TurnIntoMenu.registerBubblePopup ↔ link-input ownership ↔
// bubbleEscapeShouldCollapse. Existing coverage (test/format-bubble.test.tsx) targets
// the inner FormatBubbleToolbar directly and re-implements the Esc listener in a stub —
// it deliberately bypasses the portal wrapper because BubbleMenu's floating-ui cannot
// mount in jsdom. This is the first test of the REAL stack: real BubbleMenu portal, real
// focus, real document keydown, in chromium.
//
// It pins four contracts:
//   1. a non-empty selection shows the bubble (portal renders),
//   2. toggling bold applies the mark AND keeps the selection + editor focus,
//   3. a Turn-into transform preserves the selection,
//   4. the two-stage Esc: one Esc cancels the link input WITHOUT collapsing the
//      selection; a second Esc collapses it (the bubbleEscapeShouldCollapse contract).
// ---------------------------------------------------------------------------------

afterEach(cleanup)

let editorRef: Editor | null = null
beforeEach(() => {
  editorRef = null
})

function Harness() {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right']
      })
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }
      ]
    },
    onCreate: ({ editor: e }) => {
      editorRef = e
    }
  })
  return (
    <>
      {editor && (
        <>
          <EditorContent editor={editor} />
          <FormatBubble editor={editor} />
        </>
      )}
    </>
  )
}

/** Select "hello" (positions 1..6) with real editor focus so the BubbleMenu shows. */
function selectHello() {
  editorRef!.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
}

function selText(): string {
  const { from, to } = editorRef!.state.selection
  return editorRef!.state.doc.textBetween(from, to)
}

async function mountAndSelect() {
  render(<Harness />)
  await expect.poll(() => editorRef !== null).toBe(true)
  selectHello()
  // The portalled bubble appears on a non-empty selection.
  await expect
    .element(page.getByRole('toolbar', { name: 'Text formatting' }))
    .toBeInTheDocument()
}

describe('#758 FormatBubble real portal/focus/Esc stack (real browser)', () => {
  it('shows the bubble on a selection and toggles bold, keeping selection + focus', async () => {
    await mountAndSelect()

    await userEvent.click(page.getByRole('button', { name: 'Bold' }))

    // Mark applied…
    await expect.poll(() => editorRef!.isActive('bold')).toBe(true)
    // …and the selection is intact (mousedown preventDefault kept it), not collapsed.
    expect(editorRef!.state.selection.empty).toBe(false)
    expect(selText()).toBe('hello')
    // Editor kept DOM focus (the bubble stays visible for the next action).
    expect(editorRef!.view.hasFocus()).toBe(true)
  })

  it('applies a Turn-into transform without collapsing the selection', async () => {
    await mountAndSelect()

    await userEvent.click(page.getByRole('button', { name: 'Turn into' }))
    // The Quote leaf applies directly (blockquote wraps the paragraph).
    const quote = page.getByRole('menuitemradio', { name: /Quote/ })
    await expect.element(quote).toBeInTheDocument()
    await userEvent.click(quote)

    await expect.poll(() => editorRef!.isActive('blockquote')).toBe(true)
    // Selection survives the wrap — still spanning "hello", not collapsed.
    expect(editorRef!.state.selection.empty).toBe(false)
    expect(selText()).toBe('hello')
  })

  it('link input: first Esc cancels the input keeping the selection, second Esc collapses it', async () => {
    await mountAndSelect()

    // Open the link URL input (registers the bubble popup, so the doc Esc handler defers).
    await userEvent.click(page.getByRole('button', { name: 'Link' }))
    const url = page.getByRole('textbox', { name: 'URL' })
    await expect.element(url).toBeInTheDocument()

    // First Esc: the LinkInput's own handler cancels; the popup guard keeps the doc-level
    // handler from collapsing. Input closes, selection stays.
    await userEvent.keyboard('{Escape}')
    await expect.element(url).not.toBeInTheDocument()
    // Back to the toolbar, selection intact.
    await expect
      .element(page.getByRole('toolbar', { name: 'Text formatting' }))
      .toBeInTheDocument()
    expect(editorRef!.state.selection.empty).toBe(false)
    expect(selText()).toBe('hello')

    // Second Esc: no popup open now → the doc-level handler collapses the selection,
    // which makes shouldShow go false and hides the bubble.
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => editorRef!.state.selection.empty).toBe(true)
    await expect
      .element(page.getByRole('toolbar', { name: 'Text formatting' }))
      .not.toBeInTheDocument()
  })
})
