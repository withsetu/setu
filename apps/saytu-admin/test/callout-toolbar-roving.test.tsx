import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Callout } from '../src/editor/extensions/Callout'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Callout],
    content: {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { mdAttrs: { type: 'info' } },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
        },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('Callout style toolbar — roving tabindex + Esc-to-body', () => {
  it('renders .block-props with role="toolbar" and aria-label', async () => {
    render(<Harness onReady={() => {}} />)
    const toolbar = await screen.findByRole('toolbar', { name: /callout style/i })
    expect(toolbar).toBeTruthy()
  })

  it('all tone-swatch and icon buttons carry data-toolbar-item', async () => {
    render(<Harness onReady={() => {}} />)
    const toolbar = await screen.findByRole('toolbar', { name: /callout style/i })
    const items = toolbar.querySelectorAll('[data-toolbar-item]')
    // At least 6 tone swatches + 8 icon buttons = ≥ 14
    expect(items.length).toBeGreaterThanOrEqual(14)
  })

  it('ArrowRight moves focus from the first to the second data-toolbar-item', async () => {
    render(<Harness onReady={() => {}} />)
    const toolbar = await screen.findByRole('toolbar', { name: /callout style/i })
    const items = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-item]'))
    // Focus the first item
    items[0]?.focus()
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(items[1])
  })

  it('Escape moves focus back into the callout body (editor is focused)', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const toolbar = await screen.findByRole('toolbar', { name: /callout style/i })
    const items = Array.from(toolbar.querySelectorAll<HTMLElement>('[data-toolbar-item]'))
    items[0]?.focus()
    fireEvent.keyDown(toolbar, { key: 'Escape' })
    expect(editor.isFocused).toBe(true)
  })
})
