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

  it('editing an existing link updates the whole href and round-trips', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello', marks: [{ type: 'link', attrs: { href: 'https://old.com' } }] }] }] } })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    act(() => { editor.chain().focus().setTextSelection({ from: 2, to: 4 }).run() }) // caret inside the link
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))
    const field = screen.getByRole('textbox', { name: /url/i }) as HTMLInputElement
    expect(field.value).toBe('https://old.com') // pre-filled with the existing href
    fireEvent.change(field, { target: { value: 'https://new.com' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    const md = tiptapToMarkdoc(editor.getJSON())
    expect(md).toContain('[hello](https://new.com)')
    expect(md).not.toContain('old.com')
  })

  it('removing a link via the toolbar unlinks the text', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello', marks: [{ type: 'link', attrs: { href: 'https://x.com' } }] }] }] } })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    act(() => { editor.chain().focus().setTextSelection({ from: 2, to: 4 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove link/i }))
    expect(editor.isActive('link')).toBe(false)
    expect(tiptapToMarkdoc(editor.getJSON())).not.toContain('](https://x.com)')
  })

  it('changing the selection closes an open link input (no stale target)', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha beta' }] }] } })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run() }) // "alpha"
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))
    expect(screen.getByRole('textbox', { name: /url/i })).toBeInTheDocument()
    act(() => { editor.chain().focus().setTextSelection({ from: 7, to: 11 }).run() }) // "beta"
    expect(screen.queryByRole('textbox', { name: /url/i })).not.toBeInTheDocument() // input closed
  })
})
