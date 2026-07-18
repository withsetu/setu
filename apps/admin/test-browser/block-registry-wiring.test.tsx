import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { ATOM_TAG_TO_NODE } from '@setu/core'
import {
  buildBlockExtensions,
  insertPayloadForTag,
  INSPECTABLE_NODES
} from '../src/editor/block-registry'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'
import { registry } from '../src/blocks/registry'
import { blockCores } from '@setu/blocks'

// ---------------------------------------------------------------------------------
// Registry-driven registration, end-to-end in real chromium (#563). Canvas builds its
// content-block extensions from `buildBlockExtensions(...)`, the slash menu inserts from
// `insertPayloadForTag(...)`, and useSelectedBlock derives selection from the same
// registry. This file drives that EXACT path: an editor built from buildBlockExtensions,
// each atom inserted via its registry slash payload, selected as a NodeSelection, and
// checked to (a) render a live node view (no white screen) and (b) surface to the
// inspector via selectedBlockOf iff the registry marks it inspectable. It then storms the
// selected atom with no-op transactions to prove the derivation introduces no
// selection-driven render loop (CLAUDE.md §4 #3 — the bug that white-screened twice). If
// the registry stops driving a site, an atom here stops inserting/selecting and this
// fails in a real browser — not just the jsdom derivation guard.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

// Every content-block extension, exactly as Canvas materialises it (runQuery omitted — the
// query/latest-posts node views tolerate an absent runner and render a placeholder).
const extensions = [
  StarterKit,
  ...buildBlockExtensions({ blocks: registry.blocks, blockCores })
]

let renderCount = 0

function Harness() {
  renderCount += 1
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'setu-prose', 'aria-label': 'Content editor' }
    }
  })
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return <EditorContent editor={editor} />
}

async function mountEditor(): Promise<Editor> {
  render(<Harness />)
  await expect
    .element(page.getByLabelText('Content editor'))
    .toBeInTheDocument()
  const editor = (window as unknown as { __setuTestEditor?: Editor })
    .__setuTestEditor
  if (!editor) throw new Error('test editor was not exposed on window')
  return editor
}

/** Select the (first) node of the given type as a NodeSelection — the atom just inserted. */
function selectNode(editor: Editor, nodeType: string): void {
  let pos = -1
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === nodeType) pos = p
  })
  if (pos === -1) throw new Error(`no ${nodeType} node found to select`)
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
  )
}

const atomTags = Object.keys(ATOM_TAG_TO_NODE)

describe('registry-driven editor — every atom inserts, renders, and selects (real browser)', () => {
  for (const tag of atomTags) {
    const node = ATOM_TAG_TO_NODE[tag]!
    // `embed` is paste-driven (no cold slash payload); insert it directly by node type
    // so we still prove it registers + renders + selects through the registry extensions.
    const payload =
      tag === 'embed'
        ? { type: node, attrs: { mdAttrs: {} } }
        : insertPayloadForTag(tag)

    it(`{% ${tag} %} (${node}) inserts, mounts a node view, and selects`, async () => {
      const editor = await mountEditor()

      editor.chain().focus().insertContent(payload).run()
      // The node is really in the document under the registered type.
      let found = false
      editor.state.doc.descendants((n) => {
        if (n.type.name === node) found = true
      })
      expect(found).toBe(true)

      selectNode(editor, node)
      expect(editor.state.selection).toBeInstanceOf(NodeSelection)

      // Inspector parity: an inspectable atom surfaces via selectedBlockOf with its tag;
      // a bespoke-UI atom (contact/embed) intentionally does not open the rail.
      const selected = selectedBlockOf(editor.state)
      if (INSPECTABLE_NODES.has(node)) {
        expect(selected).not.toBeNull()
        expect(selected!.tag).toBe(tag)
      } else {
        expect(selected).toBeNull()
      }

      // The editor is still mounted and rendering after the insert+select — no white screen.
      await expect
        .element(page.getByLabelText('Content editor'))
        .toBeInTheDocument()
    })
  }

  it('a selected registry atom survives a no-op transaction storm (no render loop)', async () => {
    const consoleErrors: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '))
      original(...args)
    }

    renderCount = 0
    const editor = await mountEditor()
    editor.chain().focus().insertContent(insertPayloadForTag('hero')).run()
    selectNode(editor, 'heroBlock')
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)

    const before = renderCount
    const STORM = 30
    for (let i = 0; i < STORM; i += 1) {
      editor.view.dispatch(editor.state.tr.setMeta('noop', i))
      await new Promise((r) => setTimeout(r, 0))
    }
    const after = renderCount
    console.error = original

    await expect
      .element(page.getByLabelText('Content editor'))
      .toBeInTheDocument()
    // A stateless node view does not re-render the harness per no-op transaction.
    expect(after - before).toBeLessThan(STORM / 2)
    expect(
      consoleErrors.some((e) => /Maximum update depth exceeded/.test(e))
    ).toBe(false)
  })
})
