import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, JSONContent } from '@tiptap/core'
import { SpacerBlock } from '../src/editor/extensions/SpacerBlock'

// ---------------------------------------------------------------------------------
// Spacer node view (#183): a bespoke interactive node view (drag-to-resize handle +
// keyboard resize), so per the /new-block skill it gets a real-browser test — the
// pointer/keyboard interaction and the role=slider accessibility tree are exactly
// the class jsdom cannot exercise.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

let editorRef: Editor | null = null

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, SpacerBlock],
    content,
    // capture in the create callback, not during render (react-hooks/globals)
    onCreate: ({ editor: e }) => {
      editorRef = e
    }
  })
  return <EditorContent editor={editor} />
}

const doc = (height?: number): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'spacerBlock',
      attrs: { mdAttrs: height === undefined ? {} : { height } }
    }
  ]
})

const mdHeight = (): unknown => {
  let h: unknown
  editorRef!.state.doc.descendants((n) => {
    if (n.type.name === 'spacerBlock')
      h = (n.attrs.mdAttrs as Record<string, unknown>).height
  })
  return h
}

describe('SpacerBlock node view (real browser)', () => {
  it('renders the labelled gap with an accessible resize handle', async () => {
    render(<Harness content={doc(80)} />)
    const handle = page.getByRole('slider', { name: 'Spacer height' })
    await expect.element(handle).toBeInTheDocument()
    await expect.element(handle).toHaveAttribute('aria-valuenow', '80')
    await expect.element(handle).toHaveAttribute('aria-valuemin', '8')
    await expect.element(handle).toHaveAttribute('aria-valuemax', '200')
    await expect.element(page.getByText('80 px')).toBeInTheDocument()
    // the visual gap is the real height
    const region = document.querySelector('.blk-spacer-editor') as HTMLElement
    expect(region.style.height).toBe('80px')
  })

  it('shows the contract default (48px) when no height is set', async () => {
    render(<Harness content={doc()} />)
    await expect
      .element(page.getByRole('slider', { name: 'Spacer height' }))
      .toHaveAttribute('aria-valuenow', '48')
    await expect.element(page.getByText('48 px')).toBeInTheDocument()
  })

  it('keyboard-resizes: ArrowUp/ArrowDown step the height and write mdAttrs', async () => {
    render(<Harness content={doc(80)} />)
    const handle = page.getByRole('slider', { name: 'Spacer height' })
    await expect.element(handle).toBeInTheDocument()
    // Programmatic focus: the harness loads no CSS, so the handle has a zero-height
    // box that Playwright's click visibility check rejects. The keyboard contract is
    // what's under test; pointer focus is covered by the drag test below.
    ;(handle.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '88')
    expect(mdHeight()).toBe(88)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '72')
    expect(mdHeight()).toBe(72)
  })

  it('clamps keyboard resize to the 8–200 contract range', async () => {
    render(<Harness content={doc(200)} />)
    const handle = page.getByRole('slider', { name: 'Spacer height' })
    await expect.element(handle).toBeInTheDocument()
    ;(handle.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '200')
    await userEvent.keyboard('{Home}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '8')
    expect(mdHeight()).toBe(8)
    await userEvent.keyboard('{End}')
    await expect.element(handle).toHaveAttribute('aria-valuenow', '200')
  })

  it('drag-resizes: pointer drag on the handle tracks live and commits on release', async () => {
    render(<Harness content={doc(48)} />)
    // the node view mounts async (immediatelyRender: false) — wait for it
    await expect
      .element(page.getByRole('slider', { name: 'Spacer height' }))
      .toBeInTheDocument()
    const handle = document.querySelector(
      '.blk-spacer-editor-handle'
    ) as HTMLElement
    const region = document.querySelector('.blk-spacer-editor') as HTMLElement
    const opts = { bubbles: true, pointerId: 1, clientY: 100 }
    handle.dispatchEvent(new PointerEvent('pointerdown', opts))
    // React commits the drag-start state asynchronously — wait for it before moving,
    // or the move handler still sees "not dragging" and ignores the event.
    await vi.waitFor(() => expect(region.className).toContain('is-dragging'))
    handle.dispatchEvent(
      new PointerEvent('pointermove', { ...opts, clientY: 152 })
    )
    // live-tracking during the drag (local state, not yet committed; pointermove is a
    // continuous event so React flushes async — poll the label rather than assert sync)
    await expect.element(page.getByText('100 px')).toBeInTheDocument()
    expect(region.style.height).toBe('100px')
    handle.dispatchEvent(
      new PointerEvent('pointerup', { ...opts, clientY: 152 })
    )
    // committed to the document on release
    await expect
      .element(page.getByRole('slider', { name: 'Spacer height' }))
      .toHaveAttribute('aria-valuenow', '100')
    expect(mdHeight()).toBe(100)
  })
})
