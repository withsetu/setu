import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Callout } from '../src/editor/extensions/Callout'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Callout],
    content: {
      type: 'doc',
      content: [
        { type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('Callout title↔body keyboard nav', () => {
  it('ArrowDown in the title moves the selection into the callout body', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    title.focus()
    fireEvent.keyDown(title, { key: 'ArrowDown' })
    expect(editor.state.selection.$from.depth).toBeGreaterThanOrEqual(2)
    expect(editor.isFocused).toBe(true)
  })

  it('ArrowUp at the start of the body refocuses the title input', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    editor.chain().focus().setTextSelection(2).run()
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(title)
  })
})
