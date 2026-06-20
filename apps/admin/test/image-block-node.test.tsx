import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, ImageBlock],
    content: { type: 'doc', content: [{ type: 'imageBlock', attrs: { mdAttrs: { src: '/uploads/media/abc/original.png', align: 'none' } } }] },
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

function mdAttrsOf(getJSON: () => unknown): Record<string, unknown> {
  const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
  return json.content.find((n) => n.type === 'imageBlock')?.attrs?.mdAttrs ?? {}
}

describe('ImageBlock node view', () => {
  it('renders the preview image with the resolved src', () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const img = document.querySelector('.sib-img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('/uploads/media/abc/original.png')
  })

  it('the alignment buttons set mdAttrs.align', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    fireEvent.click(await screen.findByLabelText('Align wide'))
    expect(mdAttrsOf(getJSON).align).toBe('wide')
  })

  it('the caption input updates mdAttrs.caption, and clearing it removes the key', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const cap = await screen.findByPlaceholderText(/add a caption/i)
    fireEvent.change(cap, { target: { value: 'A caption' } })
    expect(mdAttrsOf(getJSON).caption).toBe('A caption')
    fireEvent.change(cap, { target: { value: '' } })
    expect(mdAttrsOf(getJSON).caption).toBeUndefined()
  })

  it('the alt input updates mdAttrs.alt, and clearing it removes the key', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const alt = await screen.findByPlaceholderText(/alt text/i)
    fireEvent.change(alt, { target: { value: 'A cat' } })
    expect(mdAttrsOf(getJSON).alt).toBe('A cat')
    fireEvent.change(alt, { target: { value: '' } })
    expect(mdAttrsOf(getJSON).alt).toBeUndefined()
  })

  it('pressing Enter in the caption inserts a new paragraph after the imageBlock', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness onReady={(g) => (getJSON = g)} />)
    const cap = await screen.findByPlaceholderText(/add a caption/i)
    fireEvent.keyDown(cap, { key: 'Enter' })
    const json = getJSON() as { content: Array<{ type: string }> }
    // the imageBlock is still present AND a paragraph now follows it
    const types = json.content.map((n) => n.type)
    expect(types).toContain('imageBlock')
    expect(types).toContain('paragraph')
    expect(types.indexOf('paragraph')).toBeGreaterThan(types.indexOf('imageBlock'))
  })
})
