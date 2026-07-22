import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, Extensions, JSONContent } from '@tiptap/core'
import { KeyboardShortcuts } from '../src/editor/extensions/KeyboardShortcuts'
import { dismissCaretHint } from '../src/editor/caret-hint'

// ---------------------------------------------------------------------------------
// #790 — a heading is one physical line, and #784 made the SERIALIZER enforce that by
// folding a hardBreak in a heading to a single space. That fix stops the corruption but
// leaves the editor dishonest: the author presses Shift-Enter, SEES a break, saves, and
// the break is gone on reload with nothing said. This suite pins the editor half —
// the break is never created, and a hint says why.
//
// jsdom-blind class (CLAUDE.md §4 #3): what is under test is whether a real keymap
// plugin claims a real keystroke before @tiptap/extension-hard-break's own binding, and
// whether a tippy hint really paints. jsdom has no keymap precedence to speak of and no
// layout for coordsAtPos, so only a real browser can prove either.
// ---------------------------------------------------------------------------------

afterEach(cleanup)
// The hint lives on document.body (tippy), not in the render tree, and outlives its
// test by design — without this, one test's hint is still on screen when the next one
// asserts that no hint is showing yet.
afterEach(dismissCaretHint)

/** Production order (Canvas.tsx): StarterKit is declared FIRST and KeyboardShortcuts
 *  after it. Tiptap reverses the extension list when building keymap plugins
 *  (`[...this.extensions].reverse()` in ExtensionManager's `get plugins()`,
 *  @tiptap/core 3.28.0), so the LATER-declared extension's handler runs FIRST — which
 *  is the only reason our Shift-Enter can pre-empt hard-break's. A harness that put
 *  KeyboardShortcuts first would measure the opposite precedence and pass no matter
 *  what we did (#799 is exactly that trap, in the Tab suite). */
const withShortcutsAfterStarterKit = (): Extensions => [
  StarterKit,
  KeyboardShortcuts
]

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: withShortcutsAfterStarterKit(),
    content
  })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return <EditorContent editor={editor} />
}

const editorEl = () => document.querySelector('.ProseMirror') as HTMLElement
const testEditor = () => {
  const editor = (window as unknown as { __setuTestEditor?: Editor })
    .__setuTestEditor
  if (!editor) throw new Error('test editor was not exposed on window')
  return editor
}

/** How many hardBreak nodes the document currently holds. */
function breakCount(editor: Editor): number {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'hardBreak') n += 1
  })
  return n
}

/** `<br>`s painted inside the heading. Scoped to the heading on purpose: ProseMirror
 *  puts a `ProseMirror-trailingBreak` filler `<br>` in the empty trailing paragraph
 *  every doc here grows, so a document-wide count is 1 no matter what we do. */
const headingBrCount = (): number =>
  editorEl().querySelector('h2')?.querySelectorAll('br').length ?? -1

/** prosemirror-keymap resolves "Mod-" to Cmd on Apple platforms and Ctrl elsewhere
 *  (`/Mac|iP(hone|[oa]d)/.test(navigator.platform)`), so a test that hard-codes either
 *  one passes on the author's machine and is vacuous on CI's. Mirror the library. */
const MOD = /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? 'Meta' : 'Control'

const HINT = 'Headings are a single line'

const headingDoc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Chapter one' }]
    }
  ]
}
const paragraphDoc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Chapter one' }] }
  ]
}

/** Caret at the end of the FIRST block. Not `doc.content.size - 1`: StarterKit 3 ships
 *  `trailingNode`, so every doc here grows an empty paragraph at the end and the
 *  end-of-document position is inside THAT — which is how the first draft of this file
 *  ran its "heading" cases with the caret in a paragraph and watched the fix do nothing. */
const endOfFirstBlock = (editor: Editor): number =>
  (editor.state.doc.firstChild?.nodeSize ?? 2) - 1

async function renderAndFocus(content: JSONContent): Promise<Editor> {
  render(<Harness content={content} />)
  await expect.element(page.getByText('Chapter one')).toBeInTheDocument()
  // Click the real prose — the only reliable way to get real browser focus into a
  // contenteditable — then place the caret exactly.
  await userEvent.click(page.getByText('Chapter one'))
  const editor = testEditor()
  editor.commands.setTextSelection(endOfFirstBlock(editor))
  expect(document.activeElement).toBe(editorEl())
  expect(editor.state.selection.$from.parent.type.name).toBe(
    content.content?.[0]?.type
  )
  return editor
}

describe('#790 a break cannot be typed into a heading', () => {
  it('refuses Shift-Enter: no hardBreak, no <br>, caret unmoved', async () => {
    const editor = await renderAndFocus(headingDoc)
    const caret = editor.state.selection.from
    const before = JSON.stringify(editor.getJSON())

    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')

    expect(breakCount(editor)).toBe(0)
    expect(headingBrCount()).toBe(0)
    // Not a dead key AND not a surprise: the caret stays exactly where the author
    // left it, and the hint below is what tells them why nothing happened.
    expect(editor.state.selection.from).toBe(caret)
    // Nothing else was invented in its place either — no split, no dropped-out
    // paragraph, no structural edit the author did not ask for.
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('refuses Mod-Enter too', async () => {
    const editor = await renderAndFocus(headingDoc)

    await userEvent.keyboard(`{${MOD}>}{Enter}{/${MOD}}`)

    expect(breakCount(editor)).toBe(0)
    expect(headingBrCount()).toBe(0)
  })

  it('shows the hint, and it goes away on its own', async () => {
    await renderAndFocus(headingDoc)
    expect(document.body.textContent).not.toContain(HINT)

    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')

    await expect.element(page.getByText(HINT)).toBeInTheDocument()
    // Announced without stealing focus: the author keeps typing into the canvas.
    expect(document.activeElement).toBe(editorEl())
    expect(page.getByText(HINT).element().getAttribute('role')).toBe('status')

    await expect
      .poll(() => document.body.textContent?.includes(HINT), { timeout: 6000 })
      .toBe(false)
  })

  it('does not stack when the key is pressed repeatedly', async () => {
    await renderAndFocus(headingDoc)

    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')

    await expect.element(page.getByText(HINT)).toBeInTheDocument()
    // One hint replaces the last, rather than three piling up — the failure mode a
    // corner toast would have had for a keystroke an author may hit by habit.
    expect(page.getByText(HINT).elements().length).toBe(1)
  })
})

describe('#790 every other block still takes a break', () => {
  it('Shift-Enter in a paragraph still inserts one', async () => {
    const editor = await renderAndFocus(paragraphDoc)

    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')

    expect(breakCount(editor)).toBe(1)
    expect(document.body.textContent).not.toContain(HINT)
  })

  it('Mod-Enter in a paragraph still inserts one', async () => {
    const editor = await renderAndFocus(paragraphDoc)

    await userEvent.keyboard(`{${MOD}>}{Enter}{/${MOD}}`)

    expect(breakCount(editor)).toBe(1)
  })
})
