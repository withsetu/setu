import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, JSONContent } from '@tiptap/core'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'

// ---------------------------------------------------------------------------------
// #691 / #758. `useMirroredField` exists because Tiptap 3.28 batches React node-view
// re-renders onto a microtask (queueMicrotask in ReactRenderer). A plain
// `value={node.attrs…}` free-text input is therefore briefly stale between an edit and
// the deferred re-render: after the first onChange React restores the input's DOM value
// to the still-stale prop, so a SECOND change made in the SAME microtask window (typing
// a char, then clearing it) is value-equal against React's tracked value and its onChange
// NEVER FIRES — the clear is swallowed and the mdAttrs sub-key is never removed.
//
// The four node-view free-text inputs (Callout title, Image alt, ImageBlock alt+caption,
// ContactBlock name+message) all route through the hook. Before this file nothing typed
// into any of them: node-views.test.tsx only asserts static initial rendering, so the
// fix could regress with the whole suite green.
//
// Reproduction detail: the race only bites when both changes land BEFORE the deferred
// re-render flushes. userEvent awaits between keystrokes, which flushes the microtask and
// hides the bug (a directly-bound input passes under userEvent). So the two changes are
// dispatched as back-to-back SYNCHRONOUS native `input` events — no await, no microtask
// boundary between them — which is exactly the window the hook defends. Real chromium is
// the only place 3.28's queueMicrotask timing is faithful, so this lives in browser mode.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

let editorRef: Editor | null = null
// Module-level ref: reset per test or a later poll would resolve against the previous
// editor (the trap soft-break-survives-editor.test.tsx documents).
beforeEach(() => {
  editorRef = null
})

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, ImageBlock],
    content,
    onCreate: ({ editor: e }) => {
      editorRef = e
    }
  })
  return <EditorContent editor={editor} />
}

/** Read the imageBlock node's mdAttrs from live editor state. */
function imageAttrs(): Record<string, unknown> {
  let attrs: Record<string, unknown> = {}
  editorRef!.state.doc.descendants((n) => {
    if (n.type.name === 'imageBlock') {
      attrs = (n.attrs.mdAttrs ?? {}) as Record<string, unknown>
    }
  })
  return attrs
}

/** Set a controlled input's value the way a real keystroke does — through the native
 *  value setter so React's input-value tracking sees it — then dispatch a bubbling
 *  `input` event so React's onChange fires. Synchronous: two calls in a row happen in
 *  one microtask window. */
function nativeInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const imageDoc = (mdAttrs: Record<string, unknown>): JSONContent => ({
  type: 'doc',
  content: [{ type: 'imageBlock', attrs: { mdAttrs } }]
})

describe('#691 useMirroredField: a clear in the same microtask as a type is not swallowed (real browser)', () => {
  it('caption: type-then-clear empties the input AND removes the mdAttrs.caption key', async () => {
    render(<Harness content={imageDoc({ src: '/media/photo.jpg' })} />)
    await expect.poll(() => editorRef !== null).toBe(true)

    const caption = page.getByPlaceholder('Add a caption…')
    await expect.element(caption).toBeInTheDocument()
    const el = caption.element() as HTMLInputElement

    // Two changes in ONE microtask window: type "a", then clear — before 3.28's deferred
    // node-view re-render can flush. A directly-bound input restores its DOM value to the
    // stale '' after the first change, making the clear a value-equal no-op that never
    // fires onChange, so the node keeps "a". The mirror holds local state authoritative so
    // both changes commit.
    nativeInput(el, 'a')
    nativeInput(el, '')

    // Input ends empty…
    await expect.element(caption).toHaveValue('')
    // …and the sub-key is GONE (setAttrs deletes '' — not left as '' or stale 'a').
    await expect.poll(() => 'caption' in imageAttrs()).toBe(false)
  })

  it('alt: type-then-clear empties the input AND removes the mdAttrs.alt key', async () => {
    render(<Harness content={imageDoc({ src: '/media/photo.jpg' })} />)
    await expect.poll(() => editorRef !== null).toBe(true)

    const alt = page.getByPlaceholder('Alt text…')
    await expect.element(alt).toHaveValue('')
    const el = alt.element() as HTMLInputElement

    // Type a char, then clear — in one microtask window, before the deferred re-render.
    nativeInput(el, 'a')
    nativeInput(el, '')

    await expect.element(alt).toHaveValue('')
    await expect.poll(() => 'alt' in imageAttrs()).toBe(false)
  })
})
