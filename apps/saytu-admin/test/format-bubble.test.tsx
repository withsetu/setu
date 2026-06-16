import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { tiptapToMarkdoc } from '@saytu/core'
import { FormatBubbleToolbar } from '../src/editor/FormatBubble'

afterEach(cleanup)

const docOf = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const sk = () => StarterKit.configure({ link: { openOnClick: false }, underline: false })

function EditorHarness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({ immediatelyRender: false, extensions: [sk()], content: docOf('hello world') })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('marks + StarterKit config', () => {
  it('bold toggles on a selection and round-trips to Markdoc', () => {
    let editor!: Editor
    render(<EditorHarness onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).toggleBold().run() })
    expect(editor.isActive('bold')).toBe(true)
    expect(tiptapToMarkdoc(editor.getJSON())).toContain('**hello**')
  })

  it('underline is disabled (no underline mark in the schema)', () => {
    let editor!: Editor
    render(<EditorHarness onReady={(e) => (editor = e)} />)
    expect(editor.schema.marks.underline).toBeUndefined()
  })
})

describe('FormatBubbleToolbar', () => {
  function ToolbarHarness() {
    const editor = useEditor({ immediatelyRender: false, extensions: [sk()], content: docOf('hello') })
    return <>{editor && <FormatBubbleToolbar editor={editor} />}</>
  }
  it('renders mark toggle buttons + a link button in a toolbar', () => {
    render(<ToolbarHarness />)
    expect(screen.getByRole('toolbar', { name: /text formatting/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /inline code/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /strikethrough/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument()
  })

  it('reflects active marks in aria-pressed (re-renders on toggle)', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: docOf('hello') })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    const boldBtn = screen.getByRole('button', { name: /bold/i })
    expect(boldBtn).toHaveAttribute('aria-pressed', 'false')
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).toggleBold().run() })
    expect(boldBtn).toHaveAttribute('aria-pressed', 'true')
  })
})
