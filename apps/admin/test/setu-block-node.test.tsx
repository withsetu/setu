// apps/admin/test/setu-block-node.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { z } from 'zod'
import type { ResolvedBlock } from '@setu/core'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'
import { Notice } from '@setu/blocks'

afterEach(cleanup)

const notice: ResolvedBlock = {
  tag: 'notice',
  props: z.object({ tone: z.enum(['info', 'warn', 'success']).default('info'), title: z.string().optional() }),
  component: 'blocks/notice/notice.astro',
  editor: { label: 'Notice', icon: 'info' },
}

const widget: ResolvedBlock = {
  tag: 'widget',
  props: z.object({ count: z.number().default(1), flag: z.boolean().default(false), label: z.string().optional() }),
  component: 'blocks/widget/widget.astro',
  editor: { label: 'Widget' },
}

function Harness({ tag, onReady }: { tag: string; onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, createSetuBlock([notice, widget])],
    content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag, mdAttrs: {} }, content: [{ type: 'paragraph' }] }] },
  })
  if (editor) onReady(() => editor.getJSON())
  return <EditorContent editor={editor} />
}

describe('setuBlock node view', () => {
  it('renders the block label and body chrome for a known tag', async () => {
    render(<Harness tag="notice" onReady={() => {}} />)
    // The label is shown in the block head
    expect(await screen.findByText('Notice')).toBeInTheDocument()
    // No inline form — props are edited in the inspector rail now
    expect(document.querySelector('.block-props')).toBeNull()
  })
  it('degrades to body-only (no form, no crash) when the tag has no registry entry', async () => {
    render(<Harness tag="ghost" onReady={() => {}} />)
    expect(await screen.findByText('ghost')).toBeInTheDocument() // label falls back to the tag
    expect(document.querySelector('.block-props')).toBeNull()
  })
  it('the setuBlock round-trips mdAttrs through getJSON unchanged', async () => {
    let getJSON: () => unknown = () => ({})
    function HarnessWithAttrs() {
      const editor = useEditor({
        immediatelyRender: false,
        extensions: [StarterKit, createSetuBlock([notice])],
        content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag: 'notice', mdAttrs: { tone: 'warn', title: 'Hello' } }, content: [{ type: 'paragraph' }] }] },
      })
      if (editor) getJSON = () => editor.getJSON()
      return <EditorContent editor={editor} />
    }
    render(<HarnessWithAttrs />)
    await screen.findByText('Notice')
    const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const block = json.content.find((n) => n.type === 'setuBlock')
    expect(block?.attrs?.mdAttrs).toEqual({ tone: 'warn', title: 'Hello' })
  })
})

describe('setuBlock node view — real core rendering', () => {
  it('renders the block\'s real React core in-canvas when a core is registered', async () => {
    const noticeBlock: ResolvedBlock = {
      tag: 'notice',
      props: z.object({ tone: z.enum(['info', 'warn', 'success']).default('info'), title: z.string().optional() }),
      component: 'blocks/notice/notice.astro',
      editor: { label: 'Notice' },
    }
    function HarnessWithCore() {
      const editor = useEditor({
        immediatelyRender: false,
        extensions: [StarterKit, createSetuBlock([noticeBlock], { notice: Notice })],
        content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag: 'notice', mdAttrs: { tone: 'success', title: 'Hi' } }, content: [{ type: 'paragraph' }] }] },
      })
      return <EditorContent editor={editor} />
    }
    const { container } = render(<HarnessWithCore />)
    expect(await screen.findByText('Hi')).toBeInTheDocument()
    // the REAL core markup is in-canvas (not chrome):
    expect(container.querySelector('aside.notice.notice-success')).toBeTruthy()
    // no inline form — props are edited in the inspector rail
    expect(container.querySelector('.block-props')).toBeNull()
  })
})
