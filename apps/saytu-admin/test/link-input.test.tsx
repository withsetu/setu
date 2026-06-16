import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LinkInput } from '../src/editor/LinkInput'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { FormatBubbleToolbar } from '../src/editor/FormatBubble'
import { tiptapToMarkdoc } from '@saytu/core'
import { act } from '@testing-library/react'

afterEach(cleanup)

describe('LinkInput', () => {
  it('applies a URL on Enter', () => {
    const onApply = vi.fn()
    render(<LinkInput initial="" onApply={onApply} onCancel={vi.fn()} onRemove={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: /url/i })
    fireEvent.change(field, { target: { value: 'https://x.com' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledWith('https://x.com')
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<LinkInput initial="" onApply={vi.fn()} onCancel={onCancel} onRemove={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /url/i }), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not apply an empty/whitespace URL', () => {
    const onApply = vi.fn()
    render(<LinkInput initial="  " onApply={onApply} onCancel={vi.fn()} onRemove={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /url/i }), { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows Remove only when initial is non-empty (editing an existing link)', () => {
    const onRemove = vi.fn()
    const { rerender } = render(<LinkInput initial="" onApply={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    rerender(<LinkInput initial="https://x.com" onApply={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})

const sk = () => StarterKit.configure({ link: { openOnClick: false }, underline: false })

describe('FormatBubbleToolbar link flow', () => {
  it('creates a link over the selection and round-trips to Markdoc', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] } })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))
    const field = screen.getByRole('textbox', { name: /url/i })
    fireEvent.change(field, { target: { value: 'https://x.com' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(editor.isActive('link')).toBe(true)
    expect(tiptapToMarkdoc(editor.getJSON())).toContain('[hello](https://x.com)')
  })
})
