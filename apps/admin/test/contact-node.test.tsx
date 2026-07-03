import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ContactBlock } from '../src/editor/extensions/ContactBlock'

afterEach(cleanup)

function Harness({
  mdAttrs,
  onReady
}: {
  mdAttrs: Record<string, unknown>
  onReady?: (getJSON: () => unknown) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, ContactBlock],
    content: {
      type: 'doc',
      content: [{ type: 'contactBlock', attrs: { mdAttrs } }]
    }
  })
  if (editor && onReady) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('ContactBlock node view', () => {
  it('previews the fields and shows Subject only when enabled', async () => {
    render(<Harness mdAttrs={{ formId: 'c-1', subject: false }} />)
    expect(await screen.findByText('Message')).toBeTruthy()
    expect(screen.queryByText('Subject')).toBeNull()
    expect(screen.getByText(/spam protection/i)).toBeTruthy()

    cleanup()
    render(<Harness mdAttrs={{ formId: 'c-1', subject: true }} />)
    expect(await screen.findByText('Subject')).toBeTruthy()
  })

  it('auto-generates a formId when the block has none', async () => {
    let getJSON: () => unknown = () => ({})
    render(
      <Harness mdAttrs={{ subject: false }} onReady={(g) => (getJSON = g)} />
    )
    // Let the mount effect run + persist the generated id.
    await screen.findByText('Message')
    const json = getJSON() as {
      content: Array<{
        type: string
        attrs?: { mdAttrs?: Record<string, unknown> }
      }>
    }
    const node = json.content.find((n) => n.type === 'contactBlock')
    expect(typeof node?.attrs?.mdAttrs?.formId).toBe('string')
    expect((node?.attrs?.mdAttrs?.formId as string).length).toBeGreaterThan(0)
  })
})
