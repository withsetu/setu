import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { tiptapToMarkdoc } from '@saytu/core'
import { FormatBubbleToolbar, normalizeUrl } from '../src/editor/FormatBubble'

describe('normalizeUrl', () => {
  it('prefixes https:// for a bare domain', () => {
    expect(normalizeUrl('mayankgupta.com')).toBe('https://mayankgupta.com')
    expect(normalizeUrl('  example.com/path  ')).toBe('https://example.com/path')
  })
  it('leaves explicit schemes, root-relative, and anchor links untouched', () => {
    expect(normalizeUrl('https://x.com')).toBe('https://x.com')
    expect(normalizeUrl('http://x.com')).toBe('http://x.com')
    expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(normalizeUrl('/about')).toBe('/about')
    expect(normalizeUrl('#section')).toBe('#section')
  })
  it('returns empty for empty/whitespace input', () => {
    expect(normalizeUrl('   ')).toBe('')
  })
})

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
