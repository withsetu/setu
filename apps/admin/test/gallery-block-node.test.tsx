import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { GalleryBlock } from '../src/editor/extensions/GalleryBlock'
import { slashBlocks } from '../src/editor/blocks'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'

afterEach(cleanup)

function Harness({ mdAttrs }: { mdAttrs: Record<string, unknown> }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, GalleryBlock],
    content: {
      type: 'doc',
      content: [{ type: 'galleryBlock', attrs: { mdAttrs } }]
    }
  })
  return <EditorContent editor={editor} />
}

describe('GalleryBlock node view', () => {
  it('renders the image grid read-only in the canvas', async () => {
    render(
      <Harness
        mdAttrs={{
          images: [
            { src: '/media/2026/07/a.webp', alt: 'A' },
            { src: '/media/2026/07/b.webp' }
          ],
          columns: 2
        }}
      />
    )
    await screen.findByAltText('A')
    expect(document.querySelector('.blk-gallery.cols-2')).toBeTruthy()
    expect(document.querySelectorAll('.blk-gallery-item').length).toBe(2)
  })

  it('renders an inviting empty state for a fresh gallery (no undefined)', async () => {
    render(<Harness mdAttrs={{}} />)
    expect(await screen.findByText(/add images/i)).toBeTruthy()
    expect(document.querySelector('.blk-gallery-empty')).toBeTruthy()
    expect(document.body.textContent).not.toContain('undefined')
  })
})

describe('gallery slash + inspector wiring', () => {
  it('slash menu offers Gallery under media, keyword-searchable, inserting a galleryBlock', () => {
    const entry = slashBlocks().find((b) => b.title === 'Gallery')
    expect(entry).toBeDefined()
    expect(entry!.group).toBe('media')
    expect(entry!.keywords).toEqual(expect.arrayContaining(['photos', 'grid']))
    let inserted: unknown
    const mockEditor = {
      chain: () => {
        const chain = {
          focus: () => chain,
          deleteRange: () => chain,
          insertContent: (c: unknown) => {
            inserted = c
            return chain
          },
          run: () => {}
        }
        return chain
      }
    } as never
    entry!.run(mockEditor, { from: 0, to: 0 })
    expect((inserted as { type: string }).type).toBe('galleryBlock')
  })

  it('selecting a galleryBlock surfaces tag "gallery" for the inspector rail', () => {
    const e = new Editor({
      extensions: [StarterKit, GalleryBlock],
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          {
            type: 'galleryBlock',
            attrs: { mdAttrs: { images: [{ src: '/media/a.webp' }] } }
          }
        ]
      }
    })
    e.view.dispatch(
      e.state.tr.setSelection(NodeSelection.create(e.state.doc, 2))
    )
    const sel = selectedBlockOf(e.state)
    expect(sel).toMatchObject({
      tag: 'gallery',
      mdAttrs: { images: [{ src: '/media/a.webp' }] }
    })
    e.destroy()
  })
})
