import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'
import { DragHandle } from '../src/editor/extensions/DragHandle'

// ---------------------------------------------------------------------------------
// Grip position tracks the hovered block's LEFT edge (#875). The full-pane canvas
// centers each block individually (editor.css: per-block max-width +
// margin-inline:auto), so a grip pinned at left:0 sits at the pane's far-left edge,
// away from the text it controls — exactly the bug #875 reports. This is the
// jsdom-blind class: jsdom has no layout, so getBoundingClientRect/offsetParent are
// all zeros there and a left:0 regression would pass. Real chromium computes real
// rects, so the assertions below genuinely fail against the reverted code
// (kill-shot verified: with `grip.style.left = '0px'` restored, the test fails).
// ---------------------------------------------------------------------------------

afterEach(cleanup)

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, DragHandle],
    content
  })
  return (
    <div style={{ width: 700 }}>
      {/* Mimic the canvas's per-block centering: narrow blocks centered in a wide
          pane, with the second block wider than the first so the two blocks have
          DIFFERENT left edges — proving the grip follows the hovered block, not a
          fixed offset. */}
      <style>{`
        .ProseMirror > * { max-width: 200px; margin-inline: auto; }
        .ProseMirror > *:nth-child(2) { max-width: 400px; }
      `}</style>
      <EditorContent editor={editor} />
    </div>
  )
}

function hover(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  el.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.left + 5,
      clientY: rect.top + rect.height / 2
    })
  )
}

function gripLeft(): { grip: HTMLElement; left: number } {
  const grip = document.querySelector<HTMLElement>('.blk-grip')
  expect(grip).not.toBeNull()
  return { grip: grip!, left: parseFloat(grip!.style.left) }
}

describe('DragHandle grip position (real browser)', () => {
  it('positions the grip at the hovered block left edge, not the pane edge', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Narrow centered block' }]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Wide centered block' }]
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByText('Narrow centered block'))
      .toBeInTheDocument()

    const paras = document.querySelectorAll<HTMLElement>('.ProseMirror > p')
    expect(paras.length).toBe(2)

    // Hover the narrow (200px) block: grip.left must land at ITS left edge,
    // measured against the grip's offset parent.
    hover(paras[0]!)
    const { grip, left: narrowLeft } = gripLeft()
    expect(grip.style.display).toBe('flex')
    const mountLeft = (grip.offsetParent as HTMLElement).getBoundingClientRect()
      .left
    const narrowExpected = paras[0]!.getBoundingClientRect().left - mountLeft
    // Guard against a degenerate layout where "centered" == 0: if the block's left
    // edge were at the pane edge, a hardcoded left:0 would coincidentally pass and
    // the tracking assertion below would be vacuous.
    expect(narrowExpected).toBeGreaterThan(100)
    expect(Math.abs(narrowLeft - narrowExpected)).toBeLessThan(1.5)

    // Hover the wide (400px) block: a DIFFERENT left edge, and the grip follows it.
    hover(paras[1]!)
    const { left: wideLeft } = gripLeft()
    const wideExpected = paras[1]!.getBoundingClientRect().left - mountLeft
    expect(wideExpected).toBeGreaterThan(100)
    expect(Math.abs(wideLeft - wideExpected)).toBeLessThan(1.5)
    expect(wideLeft).toBeLessThan(narrowLeft)
  })
})
