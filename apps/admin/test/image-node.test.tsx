import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Image } from '../src/editor/extensions/Image'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Image],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'image', attrs: { src: '/uploads/media/x/original.png', alt: 'a cat', title: null } },
        ] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('Image node', () => {
  it('renders an <img> whose src is resolved against VITE_SETU_API', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const img = (await screen.findAllByRole('img'))[0]!
    // jsdom resolves the src to an absolute URL; assert the path + that it is not the bare root-relative origin
    expect(img.getAttribute('src')).toMatch(/\/uploads\/media\/x\/original\.png$/)
    expect(img.getAttribute('alt')).toBe('a cat')
  })

  it('accepts the image node in the schema and round-trips its attrs through getJSON', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const json = editor.getJSON()
    const node = json.content?.[0]?.content?.[0]
    expect(node).toEqual({ type: 'image', attrs: { src: '/uploads/media/x/original.png', alt: 'a cat', title: null } })
  })
})
