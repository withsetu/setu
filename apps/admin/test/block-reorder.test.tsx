import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { moveBlock } from '../src/editor/block-reorder'

afterEach(cleanup)

const para = (t: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: t }]
})
const docOf = (...texts: string[]) => ({
  type: 'doc',
  content: texts.map(para)
})

function Harness({
  texts,
  onReady
}: {
  texts: string[]
  onReady: (e: Editor) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: docOf(...texts)
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

/** Run moveBlock against the editor's live doc and return the resulting paragraph order. */
function orderAfterMove(editor: Editor, from: number, to: number): string[] {
  const tr = editor.state.tr
  const ok = moveBlock(editor.state.doc, tr, from, to)
  if (ok) editor.view.dispatch(tr)
  const json = editor.getJSON() as {
    content: Array<{ content?: Array<{ text?: string }> }>
  }
  return json.content.map((n) => n.content?.[0]?.text ?? '')
}

describe('moveBlock', () => {
  it('moves a block up, down, and across multiple positions', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    expect(orderAfterMove(editor, 0, 1)).toEqual(['B', 'A', 'C']) // A down past B
  })

  it('moves the last block up before its predecessor', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    expect(orderAfterMove(editor, 2, 1)).toEqual(['A', 'C', 'B'])
  })

  it('moves the first block to the end', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    expect(orderAfterMove(editor, 0, 2)).toEqual(['B', 'C', 'A'])
  })

  it('is a no-op for same index or out-of-range', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    const tr = editor.state.tr
    expect(moveBlock(editor.state.doc, tr, 1, 1)).toBe(false)
    expect(moveBlock(editor.state.doc, tr, 0, 5)).toBe(false)
    expect(moveBlock(editor.state.doc, tr, -1, 0)).toBe(false)
  })
})
