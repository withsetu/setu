import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ContactBlock } from '../src/editor/extensions/ContactBlock'

afterEach(cleanup)

function mdAttrsOf(getJSON: () => unknown): Record<string, unknown> {
  const json = getJSON() as {
    content: Array<{
      type: string
      attrs?: { mdAttrs?: Record<string, unknown> }
    }>
  }
  return (
    json.content.find((n) => n.type === 'contactBlock')?.attrs?.mdAttrs ?? {}
  )
}

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

  // Regression guard for #691: Tiptap 3.28 re-renders React node views on a deferred
  // microtask, so a clear typed straight after a value was swallowed by React's
  // controlled-input reconciliation and the field never cleared. The mirrored-field
  // input keeps the clear live. Reverting the input to `value={formLabel}` fails this.
  it('the form-name input updates and clears without being swallowed', async () => {
    let getJSON: () => unknown = () => ({})
    render(
      <Harness
        mdAttrs={{ formId: 'c-1', subject: false }}
        onReady={(g) => (getJSON = g)}
      />
    )
    fireEvent.click(await screen.findByLabelText('Form settings'))
    const name = await screen.findByLabelText('Form name')
    fireEvent.change(name, { target: { value: 'Newsletter' } })
    expect(mdAttrsOf(getJSON).formLabel).toBe('Newsletter')
    fireEvent.change(name, { target: { value: '' } })
    expect(mdAttrsOf(getJSON).formLabel).toBe('')
  })
})
