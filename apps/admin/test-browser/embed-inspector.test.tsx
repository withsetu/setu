import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from 'vitest/browser'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { blockCores } from '@setu/blocks'
import { buildBlockExtensions } from '../src/editor/block-registry'
import { useSelectedBlock } from '../src/editor/useSelectedBlock'
import { BlockInspector } from '../src/editor/BlockInspector'
import { registry } from '../src/blocks/registry'
import { NotificationProvider } from '../src/ui/notify'
import '../src/styles/tokens.css'
import '../src/styles/editor.css'

// ---------------------------------------------------------------------------------
// #1249 — the embed block's caption / aspect ratio / width are edited in the inspector
// rail. This drives the SAME wiring EditorScreen uses — an editor built from the registry
// extensions, `useSelectedBlock` feeding `BlockInspector`, edits written back through
// `update` — in real chromium, because it crosses the canvas React loop (CLAUDE.md §4 #3:
// a selection-derived inspector over a ProseMirror node view is the jsdom-blind class).
// It proves: selecting an embed opens the rail with exactly those three controls; each
// edit lands in the node's mdAttrs; and the canvas card reflects it (caption under the
// card, the chosen aspect ratio, the wide breakout).
// ---------------------------------------------------------------------------------

afterEach(cleanup)

const extensions = [
  StarterKit,
  ...buildBlockExtensions({ blocks: registry.blocks, blockCores })
]

const EMBED = {
  url: 'https://youtu.be/abc',
  provider: 'youtube',
  providerLabel: 'YouTube',
  mediaType: 'video',
  title: 'Clip title',
  embedUrl: 'https://www.youtube.com/embed/abc',
  width: 480,
  height: 270
}

function Harness() {
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'embedBlock', attrs: { mdAttrs: EMBED } }
      ]
    },
    editorProps: {
      attributes: { class: 'setu-prose', 'aria-label': 'Content editor' }
    }
  })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  const selected = useSelectedBlock(editor)
  return (
    <div style={{ display: 'flex' }}>
      {/* A fixed, wide canvas so none/wide/full resolve to distinct widths. */}
      <div className="ed-canvas" style={{ width: 1400, flex: 'none' }}>
        <EditorContent editor={editor} />
      </div>
      {selected ? (
        <aside aria-label="Block inspector">
          <BlockInspector
            tag={selected.tag}
            mdAttrs={selected.mdAttrs}
            onChange={(name, value) => selected.update(name, value)}
            apiBase=""
          />
        </aside>
      ) : null}
    </div>
  )
}

const testEditor = (): Editor => {
  const editor = (window as unknown as { __setuTestEditor?: Editor })
    .__setuTestEditor
  if (!editor) throw new Error('test editor was not exposed on window')
  return editor
}

const embedPos = (editor: Editor): number => {
  let pos = -1
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === 'embedBlock') pos = p
  })
  if (pos === -1) throw new Error('no embedBlock in the doc')
  return pos
}

const embedAttrs = (editor: Editor): Record<string, unknown> =>
  editor.state.doc.nodeAt(embedPos(editor))!.attrs.mdAttrs as Record<
    string,
    unknown
  >

/** The node view's outer wrapper — the direct `.setu-prose` child the canvas width
 *  rules size. */
const canvasWrapper = (): HTMLElement =>
  document
    .querySelector('[data-tag="embed"]')!
    .closest('.setu-prose > *') as HTMLElement

describe('embed block — inspector editing (#1249, real browser)', () => {
  it('selecting an embed opens the inspector with caption, aspect ratio and width', async () => {
    render(<Harness />, { wrapper: NotificationProvider })
    await expect
      .element(page.getByLabelText('Content editor'))
      .toBeInTheDocument()
    const editor = testEditor()
    await expect
      .poll(() => document.querySelector('[data-tag="embed"]'))
      .toBeTruthy()

    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, embedPos(editor))
      )
    )
    const rail = page.getByRole('complementary', { name: 'Block inspector' })
    await expect.element(rail).toBeInTheDocument()
    await expect.element(page.getByLabelText('caption')).toBeInTheDocument()
    await expect
      .element(page.getByRole('combobox', { name: 'ratio' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('radio', { name: 'wide' }))
      .toBeInTheDocument()
    // The resolved oEmbed data has no control (it is `managed`).
    expect(page.getByLabelText('url').elements()).toHaveLength(0)
    expect(page.getByLabelText('embedUrl').elements()).toHaveLength(0)
  })

  it('edits caption, ratio and width into the node, and the canvas card reflects each', async () => {
    render(<Harness />, { wrapper: NotificationProvider })
    await expect
      .poll(() => document.querySelector('[data-tag="embed"]'))
      .toBeTruthy()
    const editor = testEditor()
    const noneWidth = canvasWrapper().getBoundingClientRect().width
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, embedPos(editor))
      )
    )

    // Caption → attrs + shown under the card.
    const caption = page.getByLabelText('caption')
    await caption.fill('A caption from the rail')
    await expect
      .poll(() => embedAttrs(editor).caption)
      .toBe('A caption from the rail')
    const figcaption = () =>
      document.querySelector<HTMLElement>('[data-embed-caption]')
    await expect
      .poll(() => figcaption()?.textContent)
      .toBe('A caption from the rail')
    // Under the card, not inside it.
    const card = document.querySelector('[data-tag="embed"]') as HTMLElement
    expect(card.contains(figcaption())).toBe(false)
    expect(figcaption()!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      card.getBoundingClientRect().bottom
    )

    // Aspect ratio → attrs + the card's media box takes that ratio (width/height
    // 480×270 is the fallback before the pick).
    const media = () =>
      document.querySelector('[data-embed-media]') as HTMLElement
    expect(getComputedStyle(media()).aspectRatio).toBe('480 / 270')
    await page.getByRole('combobox', { name: 'ratio' }).click()
    await page.getByRole('option', { name: '21:9' }).click()
    await expect.poll(() => embedAttrs(editor).ratio).toBe('21:9')
    await expect
      .poll(() => getComputedStyle(media()).aspectRatio)
      .toBe('21 / 9')
    const box = media().getBoundingClientRect()
    expect(box.width / box.height).toBeCloseTo(21 / 9, 1)

    // Width → attrs + the canvas wrapper breaks out of the reading measure.
    await page.getByRole('radio', { name: 'wide' }).click()
    await expect.poll(() => embedAttrs(editor).align).toBe('wide')
    await expect
      .poll(() => canvasWrapper().getBoundingClientRect().width)
      .toBeGreaterThan(noneWidth + 100)
    const wideWidth = canvasWrapper().getBoundingClientRect().width
    await page.getByRole('radio', { name: 'full' }).click()
    await expect.poll(() => embedAttrs(editor).align).toBe('full')
    await expect
      .poll(() => canvasWrapper().getBoundingClientRect().width)
      .toBeGreaterThan(wideWidth)

    // The resolved data survived every presentation edit untouched.
    expect(embedAttrs(editor)).toMatchObject(EMBED)

    // Clearing the caption removes the attribute (no empty `caption=""`) and the line.
    await caption.fill('')
    await expect.poll(() => 'caption' in embedAttrs(editor)).toBe(false)
    await expect.poll(() => figcaption()).toBeNull()
  })
})
