import { describe, it, expect, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Image } from '../src/editor/extensions/Image'

afterEach(cleanup)

const altOf = (editor: Editor): unknown =>
  (
    editor.getJSON().content?.[0]?.content?.[0] as {
      attrs?: { alt?: unknown }
    }
  )?.attrs?.alt

/** Harness whose inline image starts with the given alt (defaults empty). */
function AltHarness({
  alt,
  onReady
}: {
  alt: string
  onReady: (e: Editor) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Image],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { src: '/uploads/media/x/original.png', alt, title: null }
            }
          ]
        }
      ]
    }
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Image],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: '/uploads/media/x/original.png',
                alt: 'a cat',
                title: null
              }
            }
          ]
        }
      ]
    }
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('Image node', () => {
  it('renders an <img> whose src is resolved against VITE_SETU_API', async () => {
    render(<Harness onReady={() => {}} />)
    const img = (await screen.findAllByRole('img'))[0]!
    // jsdom resolves the src to an absolute URL; assert the path + that it is not the bare root-relative origin
    expect(img.getAttribute('src')).toMatch(
      /\/uploads\/media\/x\/original\.png$/
    )
    expect(img.getAttribute('alt')).toBe('a cat')
  })

  it('renders its <img> as not natively draggable (#384)', async () => {
    render(<Harness onReady={() => {}} />)
    const img = (await screen.findAllByRole('img'))[0]!
    expect(img.getAttribute('draggable')).toBe('false')
  })

  it('accepts the image node in the schema and round-trips its attrs through getJSON', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const json = editor.getJSON()
    const node = json.content?.[0]?.content?.[0]
    expect(node).toEqual({
      type: 'image',
      attrs: { src: '/uploads/media/x/original.png', alt: 'a cat', title: null }
    })
  })

  // Regression guard for #691: the selected-image alt input is a controlled text
  // field. Under Tiptap 3.28 the node view re-renders on a deferred microtask, so
  // typing an alt and immediately clearing it was swallowed (couldn't clear the
  // alt). The mirrored-field input keeps the clear live. Starting from an empty
  // alt is what reproduces the swallow (the reconciled-back value must equal the
  // clear target); reverting the input to `value={alt}` fails this test.
  it('the alt input updates the node attr, and clearing it right after typing is not swallowed', async () => {
    let editor!: Editor
    render(<AltHarness alt="" onReady={(e) => (editor = e)} />)
    await waitFor(() => expect(editor).toBeTruthy())
    // Select the inline image so its alt input renders.
    editor.chain().setNodeSelection(1).run()
    const alt = await screen.findByPlaceholderText(/alt text/i)
    fireEvent.change(alt, { target: { value: 'tabby cat' } })
    expect(altOf(editor)).toBe('tabby cat')
    fireEvent.change(alt, { target: { value: '' } })
    expect(altOf(editor)).toBe('')
  })
})
