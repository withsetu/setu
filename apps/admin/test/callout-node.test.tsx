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

function mdAttrsOf(getJSON: () => unknown): Record<string, unknown> {
  const json = getJSON() as {
    content: Array<{
      type: string
      attrs?: { mdAttrs?: Record<string, unknown> }
    }>
  }
  return json.content.find((n) => n.type === 'callout')?.attrs?.mdAttrs ?? {}
}

describe('Callout node view', () => {
  it('renders a title input and the body, and editing the title updates mdAttrs.title', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    fireEvent.change(title, { target: { value: 'Heads up' } })
    expect(mdAttrsOf(getJSON).title).toBe('Heads up')
  })

  // Regression guard for #691: under Tiptap 3.28 the node view re-renders on a
  // deferred microtask, so a clear typed straight after a title was swallowed and
  // the `title` key lingered. The mirrored-field input keeps the clear live.
  it('the title input updates mdAttrs.title, and clearing it removes the key', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    fireEvent.change(title, { target: { value: 'Heads up' } })
    expect(mdAttrsOf(getJSON).title).toBe('Heads up')
    fireEvent.change(title, { target: { value: '' } })
    expect(mdAttrsOf(getJSON).title).toBeUndefined()
  })
})
