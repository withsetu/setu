import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Image } from '../src/editor/extensions/Image'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'
import { ImageDragGuard } from '../src/editor/extensions/ImageDragGuard'

// ---------------------------------------------------------------------------------
// #384 regression: grabbing the image ITSELF (not the drag handle) inside the canvas
// and releasing it used to trigger the browser's NATIVE image drag; ProseMirror's
// default drop handler then parsed the dragged `<img>` HTML through the generic
// `img[src]` rule into a phantom INLINE `image` node (no toolbar/inspector), while
// the original imageBlock stayed put — duplicated, corrupting content on save.
// This is native-drag behavior, so the test must run in a real browser: jsdom has no
// DataTransfer and no native drag semantics.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

function Harness({ onEditor }: { onEditor: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Image, ImageBlock, ImageDragGuard],
    content: {
      type: 'doc',
      content: [
        {
          type: 'imageBlock',
          attrs: {
            mdAttrs: { src: '/media/2026/07/photo.jpg', align: 'none' }
          }
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Drop target paragraph' }]
        }
      ]
    }
  })
  if (editor) onEditor(editor)
  return <EditorContent editor={editor} />
}

const IMG_HTML = '<img src="http://localhost:4444/media/2026/07/photo.jpg">'

function imageDataTransfer(): DataTransfer {
  const dt = new DataTransfer()
  dt.setData('text/html', IMG_HTML)
  dt.setData('text/uri-list', 'http://localhost:4444/media/2026/07/photo.jpg')
  return dt
}

function dispatchDragStart(target: Element, dt: DataTransfer): boolean {
  const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  // dispatchEvent returns false when preventDefault was called
  return target.dispatchEvent(ev)
}

/** A real browser always fires dragend on the source when the drag session ends —
 *  simulate it too, or Tiptap's own PasteRule drag tracking (a module-global set on
 *  window dragstart, cleared on dragend) leaks state across tests. */
function dispatchDragEnd(target: Element): void {
  target.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
}

function dispatchDrop(editor: Editor, dt: DataTransfer): void {
  const para = editor.view.dom.querySelector('p')!
  const r = para.getBoundingClientRect()
  const ev = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2
  })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  para.dispatchEvent(ev)
}

async function setup(): Promise<{ editor: Editor; img: HTMLImageElement }> {
  let editor!: Editor
  render(<Harness onEditor={(e) => (editor = e)} />)
  // wait for the React node view to mount
  await expect.poll(() => document.querySelector('.sib-img')).not.toBeNull()
  return { editor, img: document.querySelector('.sib-img')! }
}

describe('imageBlock native image drag (#384, real browser)', () => {
  it('the node view img is not natively draggable and dragstart on it is suppressed', async () => {
    const { img } = await setup()
    expect(img.getAttribute('draggable')).toBe('false')
    const proceeded = dispatchDragStart(img, imageDataTransfer())
    expect(proceeded).toBe(false) // defaultPrevented → the browser never starts a drag
    dispatchDragEnd(img)
  })

  it('an internal image drag + drop leaves the document unchanged (no phantom node)', async () => {
    const { editor, img } = await setup()
    const before = JSON.stringify(editor.getJSON())
    const dt = imageDataTransfer()
    dispatchDragStart(img, dt)
    dispatchDrop(editor, dt)
    dispatchDragEnd(img)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    const types = (editor.getJSON().content ?? []).map((n) => n.type)
    expect(types.filter((t) => t === 'imageBlock')).toHaveLength(1)
  })

  it('a drag from an app image OUTSIDE the canvas (e.g. a panel thumbnail) is also no-opped', async () => {
    const { editor } = await setup()
    const before = JSON.stringify(editor.getJSON())
    const outside = document.createElement('img')
    outside.src = 'http://localhost:4444/media/2026/07/other.jpg'
    document.body.appendChild(outside)
    try {
      const dt = imageDataTransfer()
      dispatchDragStart(outside, dt)
      dispatchDrop(editor, dt)
      dispatchDragEnd(outside)
      expect(JSON.stringify(editor.getJSON())).toBe(before)
    } finally {
      outside.remove()
    }
  })

  it('control: an EXTERNAL image-HTML drop (no in-document dragstart) still inserts — the guard is origin-scoped', async () => {
    const { editor } = await setup()
    const before = JSON.stringify(editor.getJSON())
    dispatchDrop(editor, imageDataTransfer())
    // Proves the simulation machinery is real (the two no-op tests above are not
    // vacuously green) and that cross-window/external HTML drops keep today's behavior.
    expect(JSON.stringify(editor.getJSON())).not.toBe(before)
    expect(JSON.stringify(editor.getJSON())).toContain('"image"')
  })
})
