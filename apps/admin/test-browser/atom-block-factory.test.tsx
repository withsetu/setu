import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, JSONContent } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import {
  createAtomBlock,
  atomCoreView
} from '../src/editor/extensions/atom-block'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'

// ---------------------------------------------------------------------------------
// Factory smoke + the jsdom-blind class (#562, CLAUDE.md §4 #3): the five atom node
// views were copies of the hero Node.create; this file proves the shared factory that
// replaces them (a) builds a working atom node whose generic view renders a @setu/blocks
// core from mdAttrs, mounted against a REAL Tiptap editor in real chromium, and (b) does
// NOT introduce the historical selection-driven render loop — a factory-produced atom,
// once selected, survives a no-op transaction storm without an unbounded re-render or a
// "Maximum update depth exceeded" white-screen (the exact bug that shipped twice via
// useSelectedBlock). A stateless generic view is the fix, and this test regresses it.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

// A minimal @setu/blocks-shaped core: reads props derived from mdAttrs and renders real
// DOM — the same contract the Hero/Gallery/Video cores fulfil, without pulling their CSS.
function StubCore({ label, note }: { label: string; note?: string }) {
  return (
    <div className="blk-stub">
      <h2 className="blk-stub-label">{label}</h2>
      {note ? <p className="blk-stub-note">{note}</p> : null}
    </div>
  )
}

const TestAtom = createAtomBlock({
  name: 'testAtomBlock',
  dataAttr: 'data-setu-test-atom-block',
  view: atomCoreView('test-atom', StubCore, (md) => ({
    label: typeof md['label'] === 'string' ? md['label'] : 'Untitled',
    note: typeof md['note'] === 'string' ? md['note'] : undefined
  }))
})

let renderCount = 0

function Harness({
  extensions,
  content
}: {
  extensions: Parameters<typeof useEditor>[0]['extensions']
  content: JSONContent
}) {
  renderCount += 1
  const editor = useEditor({ immediatelyRender: false, extensions, content })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return <EditorContent editor={editor} />
}

describe('createAtomBlock — factory-produced atom node (real browser)', () => {
  it('builds an atom node whose generic view renders a core from mdAttrs', async () => {
    render(
      <Harness
        extensions={[StarterKit, TestAtom]}
        content={{
          type: 'doc',
          content: [
            {
              type: 'testAtomBlock',
              attrs: {
                mdAttrs: { label: 'Hello factory', note: 'from mdAttrs' }
              }
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Hello factory' }))
      .toBeInTheDocument()
    await expect.element(page.getByText('from mdAttrs')).toBeInTheDocument()
    // The shared `.setu-block` wrapper carries the block's markdoc tag as data-tag —
    // the inspector rail keys off this exactly as it did for the hand-written views.
    const wrapper = document.querySelector('.setu-block[data-tag="test-atom"]')
    expect(wrapper).toBeTruthy()
  })

  it('falls back sensibly with empty mdAttrs (no `undefined` on screen)', async () => {
    render(
      <Harness
        extensions={[StarterKit, TestAtom]}
        content={{
          type: 'doc',
          content: [{ type: 'testAtomBlock', attrs: { mdAttrs: {} } }]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Untitled' }))
      .toBeInTheDocument()
    expect(document.body.textContent).not.toContain('undefined')
  })

  it('survives selection + a no-op transaction storm without a render loop', async () => {
    const consoleErrors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '))
      originalError(...args)
    }

    renderCount = 0
    const { unmount } = render(
      <Harness
        extensions={[StarterKit, TestAtom]}
        content={{
          type: 'doc',
          content: [
            { type: 'paragraph' },
            {
              type: 'testAtomBlock',
              attrs: { mdAttrs: { label: 'Selectable atom' } }
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Selectable atom' }))
      .toBeInTheDocument()

    const editor = (window as unknown as { __setuTestEditor?: Editor })
      .__setuTestEditor
    if (!editor) throw new Error('test editor was not exposed on window')

    // Select the atom node (the path that historically triggered the loop once a
    // selection-driven view called setState with a fresh object per transaction).
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))
    )
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)

    const before = renderCount
    const STORM_SIZE = 30
    for (let i = 0; i < STORM_SIZE; i += 1) {
      editor.view.dispatch(editor.state.tr.setMeta('noop', i))
      await new Promise((r) => setTimeout(r, 0))
    }
    const after = renderCount

    console.error = originalError

    // The atom is still on screen after the storm — no white-screen.
    await expect
      .element(page.getByRole('heading', { name: 'Selectable atom' }))
      .toBeInTheDocument()
    // A stateless generic view does NOT re-render the harness per no-op transaction;
    // an unguarded selection-driven setState would (1:1 with STORM_SIZE).
    expect(after - before).toBeLessThan(STORM_SIZE / 2)
    expect(
      consoleErrors.some((e) => /Maximum update depth exceeded/.test(e))
    ).toBe(false)

    unmount()
  })
})

describe('createAtomBlock — a real converted atom (HeroBlock) in real browser', () => {
  it('renders the Hero core and stays mounted through selection', async () => {
    render(
      <Harness
        extensions={[StarterKit, HeroBlock]}
        content={{
          type: 'doc',
          content: [
            { type: 'paragraph' },
            {
              type: 'heroBlock',
              attrs: {
                mdAttrs: {
                  headline: 'Factory hero',
                  subhead: 'Built by the factory'
                }
              }
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Factory hero' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('Built by the factory'))
      .toBeInTheDocument()

    const editor = (window as unknown as { __setuTestEditor?: Editor })
      .__setuTestEditor
    if (!editor) throw new Error('test editor was not exposed on window')
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2))
    )
    // Still rendered after selection — the factory's addNodeView wiring is live.
    await expect
      .element(page.getByRole('heading', { name: 'Factory hero' }))
      .toBeInTheDocument()
  })
})
