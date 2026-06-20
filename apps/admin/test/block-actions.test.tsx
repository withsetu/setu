import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { tiptapToMarkdoc } from '@setu/core'
import type { TiptapDoc } from '@setu/core'
import { BlockActions } from '../src/editor/extensions/BlockActions'
import { Callout } from '../src/editor/extensions/Callout'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'

afterEach(cleanup)

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const docOf = (...texts: string[]): TiptapDoc => ({ type: 'doc', content: texts.map(para) } as TiptapDoc)

function Harness({ texts, onReady }: { texts: string[]; onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, BlockActions],
    content: docOf(...texts),
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

/** Put the cursor inside the top-level block at `index`. */
function caretInBlock(editor: Editor, index: number) {
  let pos = 1
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize
  act(() => {
    editor.commands.setTextSelection(pos + 1)
  })
}

const texts = (editor: Editor): string[] => {
  const json = editor.getJSON() as { content: Array<{ content?: Array<{ text?: string }> }> }
  return json.content.map((n) => n.content?.[0]?.text ?? '')
}

function CalloutHarness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, BlockActions, Callout],
    content: {
      type: 'doc',
      content: [
        { type: 'callout', attrs: { mdAttrs: { type: 'warning', title: 'Heads up' } }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

function CalloutParaHarness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, BlockActions, Callout],
    content: {
      type: 'doc',
      content: [
        { type: 'callout', attrs: { mdAttrs: { type: 'warning', title: 'Heads up' } }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'P' }] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('BlockActions', () => {
  it('keeps the caret in the moved paragraph when moving past a callout (up then down)', () => {
    let editor!: Editor
    render(<CalloutParaHarness onReady={(e) => (editor = e)} />)
    // caret inside the trailing paragraph 'P' (index 1)
    act(() => { editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 2) })
    expect(editor.state.selection.$from.node(1).textContent).toBe('P')
    act(() => { editor.commands.moveBlockUp() }) // P -> index 0, above the callout
    expect(editor.state.selection.$from.node(1).type.name).toBe('paragraph')
    expect(editor.state.selection.$from.node(1).textContent).toBe('P') // NOT stuck in the callout
    act(() => { editor.commands.moveBlockDown() }) // P -> index 1, back below the callout
    expect(editor.state.selection.$from.node(1).type.name).toBe('paragraph')
    expect(editor.state.selection.$from.node(1).textContent).toBe('P')
  })

  it('moveBlockDown reorders and round-trips to Markdoc', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.moveBlockDown() })
    expect(texts(editor)).toEqual(['B', 'A', 'C'])
    expect(tiptapToMarkdoc(editor.getJSON())).toBe(tiptapToMarkdoc(docOf('B', 'A', 'C')))
  })

  it('moveBlockUp at the first block is a no-op', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.moveBlockUp() })
    expect(texts(editor)).toEqual(['A', 'B'])
  })

  it('duplicateBlock inserts an identical block right after', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.duplicateBlock() })
    expect(texts(editor)).toEqual(['A', 'A', 'B'])
  })

  it('deleteBlock removes the block', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.deleteBlock() })
    expect(texts(editor)).toEqual(['B'])
  })

  it('deleteBlock on the only block leaves an empty paragraph', () => {
    let editor!: Editor
    render(<Harness texts={['A']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.deleteBlock() })
    const json = editor.getJSON() as { content: Array<{ type: string; content?: unknown[] }> }
    expect(json.content).toHaveLength(1)
    expect(json.content[0]?.type).toBe('paragraph')
    expect(json.content[0]?.content ?? []).toHaveLength(0)
  })

  it('keeps the caret inside the moved block after moveBlockDown', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0) // caret in 'A'
    act(() => { editor.commands.moveBlockDown() })
    // 'A' is now at index 1; the selection should sit inside that moved block
    expect(editor.state.selection.$from.node(1).textContent).toBe('A')
  })

  it('duplicateBlock preserves a callout mdAttrs and nested content', () => {
    let editor!: Editor
    render(<CalloutHarness onReady={(e) => (editor = e)} />)
    act(() => {
      editor.commands.setTextSelection(2) // caret inside the callout body
      editor.commands.duplicateBlock()
    })
    const json = editor.getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const callouts = json.content.filter((n) => n.type === 'callout')
    expect(callouts).toHaveLength(2)
    expect(callouts[0]?.attrs?.mdAttrs).toEqual({ type: 'warning', title: 'Heads up' })
    expect(callouts[1]?.attrs?.mdAttrs).toEqual({ type: 'warning', title: 'Heads up' })
  })
})

const IMAGE_ATTRS = { mdAttrs: { src: '/x.png', align: 'none' } }

function ImageHarness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, BlockActions, ImageBlock],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'imageBlock', attrs: IMAGE_ATTRS },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

/** Return the position (absolute start offset) of the imageBlock in the doc. */
function imageBlockPos(editor: Editor): number {
  let pos = 0
  for (let i = 0; i < editor.state.doc.childCount; i += 1) {
    const child = editor.state.doc.child(i)
    if (child.type.name === 'imageBlock') return pos
    pos += child.nodeSize
  }
  throw new Error('imageBlock not found in doc')
}

/** Select the imageBlock via a NodeSelection. */
function selectImageBlock(editor: Editor) {
  act(() => {
    const pos = imageBlockPos(editor)
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
  })
}

describe('BlockActions — top-level atom (imageBlock)', () => {
  it('deleteBlock removes the imageBlock, leaving both paragraphs', () => {
    let editor!: Editor
    render(<ImageHarness onReady={(e) => (editor = e)} />)
    selectImageBlock(editor)
    act(() => { editor.commands.deleteBlock() })
    const json = editor.getJSON() as { content: Array<{ type: string }> }
    expect(json.content.some((n) => n.type === 'imageBlock')).toBe(false)
    expect(json.content.filter((n) => n.type === 'paragraph')).toHaveLength(2)
  })

  it('moveBlockUp moves imageBlock above the first paragraph (to index 0)', () => {
    let editor!: Editor
    render(<ImageHarness onReady={(e) => (editor = e)} />)
    selectImageBlock(editor)
    act(() => { editor.commands.moveBlockUp() })
    const json = editor.getJSON() as { content: Array<{ type: string }> }
    expect(json.content[0]?.type).toBe('imageBlock')
    expect(json.content[1]?.type).toBe('paragraph')
    expect(json.content[2]?.type).toBe('paragraph')
  })

  it('duplicateBlock yields two imageBlock nodes', () => {
    let editor!: Editor
    render(<ImageHarness onReady={(e) => (editor = e)} />)
    selectImageBlock(editor)
    act(() => { editor.commands.duplicateBlock() })
    const json = editor.getJSON() as { content: Array<{ type: string }> }
    expect(json.content.filter((n) => n.type === 'imageBlock')).toHaveLength(2)
  })
})
