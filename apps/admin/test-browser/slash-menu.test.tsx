import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../src/editor/extensions/Callout'
import { Passthrough } from '../src/editor/extensions/Passthrough'
import { SlashCommand } from '../src/editor/extensions/SlashCommand'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'
import { registry } from '../src/blocks/registry'
import { blockCores } from '@setu/blocks'

// ---------------------------------------------------------------------------------
// Slash menu (#293 target 4): typing "/" in a REAL contenteditable, filtering, and
// selecting via real keyboard, against a real Tiptap editor in real chromium.
// test/slash.test.tsx already covers slashBlocks()/`.run()` directly against a
// headless (non-React) Editor — no popup ever renders there. This is the gap: the
// menu is rendered into a tippy popup appended to document.body (SlashCommand.tsx),
// which needs a real browser to open/position/filter/close for real; jsdom typing
// into contenteditable does not reliably fire the ProseMirror input events the
// Suggestion plugin listens for the same way a real browser's IME/input pipeline does.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

function Harness() {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Callout,
      Passthrough,
      createSetuBlock(registry.blocks, blockCores),
      SlashCommand
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'setu-prose', 'aria-label': 'Content editor' }
    }
  })
  return <EditorContent editor={editor} />
}

describe('Slash menu (real browser)', () => {
  it('opens on "/", filters by typed text, and inserts the selected block via keyboard', async () => {
    render(<Harness />)

    const body = page.getByLabelText('Content editor')
    await expect.element(body).toBeInTheDocument()
    await body.click()
    await userEvent.keyboard('/')

    const menu = page.getByRole('listbox', { name: 'Insert block' })
    await expect.element(menu).toBeInTheDocument()
    // Unfiltered: built-ins and folder blocks are all present, grouped.
    await expect
      .element(menu.getByRole('option', { name: /^Heading 2[A-Z]/ }))
      .toBeInTheDocument()
    await expect
      .element(menu.getByRole('option', { name: /^Callout[A-Z]/ }))
      .toBeInTheDocument()

    // Filter by typing — narrows to just the matching option(s).
    await userEvent.keyboard('callout')
    await expect
      .element(menu.getByRole('option', { name: /^Callout[A-Z]/ }))
      .toBeInTheDocument()
    await expect
      .element(menu.getByRole('option', { name: /^Heading 2[A-Z]/ }))
      .not.toBeInTheDocument()

    // Select via real keyboard (Down + Enter) — the same path e2e's insertBlock()
    // helper drives, per its own comment: "exercises the same arrow-key selection
    // path a real user takes".
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect.element(menu).not.toBeInTheDocument()

    // The callout node was really inserted into the real ProseMirror doc — its node
    // view rendered with the default tone's toolbar, a real accessible structure.
    await expect
      .element(page.getByRole('toolbar', { name: 'Callout style' }))
      .toBeInTheDocument()
  })

  it('closes on Escape without inserting anything', async () => {
    render(<Harness />)
    const body = page.getByLabelText('Content editor')
    await body.click()
    await userEvent.keyboard('/')
    const menu = page.getByRole('listbox', { name: 'Insert block' })
    await expect.element(menu).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await expect.element(menu).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('toolbar', { name: 'Callout style' }))
      .not.toBeInTheDocument()
  })
})
