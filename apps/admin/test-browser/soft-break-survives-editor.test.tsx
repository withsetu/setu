import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, JSONContent } from '@tiptap/core'
import { markdocToTiptap, tiptapToMarkdoc } from '@setu/core'
import type { TiptapDoc } from '@setu/core'

// ---------------------------------------------------------------------------------
// #667. The serializer round-trip is proven in packages/core, but the fix only holds
// if a REAL ProseMirror instance preserves the `\n` a soft break is modelled as. A
// text node carrying a newline is unusual: the browser collapses it when rendering,
// and if ProseMirror normalised it on load — or on the way back out of getJSON() —
// the core tests would stay green while every save in the actual editor still
// reflowed the paragraph. That is the jsdom-mirage class, so it is asserted here,
// against the real thing, with the real StarterKit schema.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

let editorRef: Editor | null = null
// The ref is module-level, so without this a later test's `poll(editorRef !== null)`
// is satisfied instantly by the PREVIOUS test's editor and asserts against the wrong
// document. Caught by this suite itself on first run.
beforeEach(() => {
  editorRef = null
})

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content,
    onCreate: ({ editor: e }) => {
      editorRef = e
    }
  })
  return <EditorContent editor={editor} />
}

const WRAPPED =
  'The quick brown fox jumps and\nthen keeps running\nfinally stops.\n'

describe('#667 a soft break survives a real editor load (real browser)', () => {
  it('round-trips a hard-wrapped paragraph byte-identically through ProseMirror', async () => {
    const doc = markdocToTiptap(WRAPPED) as JSONContent
    render(<Harness content={doc} />)
    await expect.poll(() => editorRef !== null).toBe(true)

    // The load-bearing assertion: what the editor hands back on save.
    const saved = editorRef!.getJSON() as TiptapDoc
    expect(tiptapToMarkdoc(saved)).toBe(WRAPPED)
  })

  it('keeps the newline inside the text node rather than collapsing it', async () => {
    render(<Harness content={markdocToTiptap('a\nb\n') as JSONContent} />)
    await expect.poll(() => editorRef !== null).toBe(true)

    const texts: string[] = []
    editorRef!.state.doc.descendants((n) => {
      if (n.isText) texts.push(n.text ?? '')
    })
    expect(texts.join('')).toBe('a\nb')
  })

  it('renders as one visual line, exactly as the published HTML does', async () => {
    render(<Harness content={markdocToTiptap('a\nb\n') as JSONContent} />)
    await expect.poll(() => editorRef !== null).toBe(true)
    // A soft break is whitespace, not a <br>: the canvas must not sprout a line
    // break the rendered site does not have.
    expect(editorRef!.view.dom.querySelectorAll('br').length).toBe(0)
  })
})
