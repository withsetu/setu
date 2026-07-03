import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import type { Editor } from '@tiptap/core'
import { FormatBubbleToolbar } from '../src/editor/FormatBubble'
import { requestLinkEdit } from '../src/editor/editor-events'

afterEach(cleanup)

const sk = () =>
  StarterKit.configure({ link: { openOnClick: false }, underline: false })
const subsupExts = () => [sk(), Subscript, Superscript]

describe('FormatBubbleToolbar shortcut hints', () => {
  it('sets aria-keyshortcuts on the mark + link buttons', () => {
    function H() {
      const e = useEditor({
        immediatelyRender: false,
        extensions: [sk()],
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }
          ]
        }
      })
      return <>{e && <FormatBubbleToolbar editor={e} />}</>
    }
    render(<H />)
    expect(screen.getByRole('button', { name: /bold/i })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+B'
    )
    expect(
      screen.getByRole('button', { name: /strikethrough/i })
    ).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+S')
    expect(screen.getByRole('button', { name: /^link$/i })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+K'
    )
  })

  it('sets aria-keyshortcuts on subscript and superscript buttons', () => {
    function H() {
      const e = useEditor({
        immediatelyRender: false,
        extensions: subsupExts(),
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }
          ]
        }
      })
      return <>{e && <FormatBubbleToolbar editor={e} />}</>
    }
    render(<H />)
    expect(
      screen.getByRole('button', { name: /^subscript$/i })
    ).toHaveAttribute('aria-keyshortcuts', 'Meta+,')
    expect(
      screen.getByRole('button', { name: /^superscript$/i })
    ).toHaveAttribute('aria-keyshortcuts', 'Meta+.')
  })

  it('opens the link input when a link edit is requested (Mod-k path)', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({
        immediatelyRender: false,
        extensions: [sk()],
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
          ]
        }
      })
      if (e) editor = e
      return (
        <>
          {e && (
            <>
              <EditorContent editor={e} />
              <FormatBubbleToolbar editor={e} />
            </>
          )}
        </>
      )
    }
    render(<H />)
    act(() => {
      editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
    })
    act(() => {
      requestLinkEdit()
    })
    expect(screen.getByRole('textbox', { name: /url/i })).toBeInTheDocument()
  })
})
