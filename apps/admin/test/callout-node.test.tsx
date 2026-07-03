import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../src/editor/extensions/Callout'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Callout],
    content: {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { mdAttrs: { type: 'info' } },
          content: [{ type: 'paragraph' }]
        }
      ]
    }
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('Callout node view', () => {
  it('renders a title input and the body, and editing the title updates mdAttrs.title', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    fireEvent.change(title, { target: { value: 'Heads up' } })
    const json = getJSON() as {
      content: Array<{
        type: string
        attrs?: { mdAttrs?: Record<string, unknown> }
      }>
    }
    const callout = json.content.find((n) => n.type === 'callout')
    expect(callout?.attrs?.mdAttrs?.title).toBe('Heads up')
  })
})
