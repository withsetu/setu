import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, cleanup } from '@testing-library/react'
import { page } from 'vitest/browser'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, JSONContent } from '@tiptap/core'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'
import { registry } from '../src/blocks/registry'
import { blockCores } from '@setu/blocks'

// ---------------------------------------------------------------------------------
// #1223: a click on a folder block's non-editable chrome (the generic label head, or a
// block core's own markup such as Notice's title) must put the caret inside THAT
// block's body, so the block is selected and the inspector opens.
//
// prosemirror-view 1.42.6 changed `posAtDOM` for DOM positions inside a node view's
// wrapper but outside its content element. Clicking the label stopped resolving into
// the block and landed in the paragraph AFTER it: no selected block, no inspector.
// SetuBlock now places that caret itself instead of relying on how the view maps a
// click on chrome; this file is what fails if it stops doing so.
// ---------------------------------------------------------------------------------

const GENERIC = 'chrome-click-fixture'
let restoreRegistry: (() => void) | null = null

beforeAll(() => {
  if (registry.blocksByTag.has(GENERIC)) return
  // No React core for this tag, so SetuBlock renders its generic label-head chrome.
  const entry = {
    tag: GENERIC,
    props: {},
    component: 'test-fixture',
    editor: { label: 'Chrome fixture', icon: 'zap', group: 'text' }
  } as unknown as (typeof registry.blocks)[number]
  registry.blocks.push(entry)
  registry.blocksByTag.set(GENERIC, entry)
  registry.knownBlockTags.add(GENERIC)
  restoreRegistry = () => {
    const idx = registry.blocks.indexOf(entry)
    if (idx >= 0) registry.blocks.splice(idx, 1)
    registry.blocksByTag.delete(GENERIC)
    registry.knownBlockTags.delete(GENERIC)
  }
})

afterAll(() => restoreRegistry?.())
afterEach(cleanup)

const para = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }]
})
const block = (
  tag: string,
  content: JSONContent[],
  mdAttrs: Record<string, unknown> = {}
): JSONContent => ({ type: 'setuBlock', attrs: { tag, mdAttrs }, content })

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, createSetuBlock(registry.blocks, blockCores)],
    content
  })
  // Test-only escape hatch: expose the live editor after commit, not during render.
  useEffect(() => {
    ;(
      window as unknown as { __setuChromeEditor?: Editor | null }
    ).__setuChromeEditor = editor
  }, [editor])
  return <EditorContent editor={editor} />
}

function editor(): Editor {
  const ed = (window as unknown as { __setuChromeEditor?: Editor | null })
    .__setuChromeEditor
  if (!ed) throw new Error('editor not mounted')
  return ed
}

/** Text of the textblock the caret sits in, and the folder block the inspector resolves. */
function caret() {
  const { state } = editor()
  return {
    text: state.selection.$from.parent.textContent,
    selected: selectedBlockOf(state)?.tag ?? null
  }
}

describe('SetuBlock: clicking non-editable chrome selects that block (#1223)', () => {
  it('a click on the generic label head puts the caret in the block body', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            para('Before'),
            block(GENERIC, [para('Body text')]),
            para('After')
          ]
        }}
      />
    )
    await page.getByText('Chrome fixture').click()
    await expect.poll(caret).toEqual({ text: 'Body text', selected: GENERIC })
  })

  it('a click in the body still places the caret where the user clicked', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [block(GENERIC, [para('First'), para('Second line')])]
        }}
      />
    )
    await page.getByText('Second line').click()
    await expect.poll(caret).toEqual({ text: 'Second line', selected: GENERIC })
  })

  it('in nested blocks, a click on the inner head selects the inner block', async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            block(
              'notice',
              [para('Outer body'), block(GENERIC, [para('Inner body')])],
              { title: 'Outer notice' }
            ),
            para('After')
          ]
        }}
      />
    )
    await page.getByText('Chrome fixture').click()
    await expect.poll(caret).toEqual({ text: 'Inner body', selected: GENERIC })
  })

  it("a click on a block core's own chrome (Notice title) puts the caret in its body", async () => {
    render(
      <Harness
        content={{
          type: 'doc',
          content: [
            para('Before'),
            block('notice', [para('Notice body')], { title: 'Heads up' }),
            para('After')
          ]
        }}
      />
    )
    await page.getByText('Heads up').click()
    await expect
      .poll(caret)
      .toEqual({ text: 'Notice body', selected: 'notice' })
  })
})
