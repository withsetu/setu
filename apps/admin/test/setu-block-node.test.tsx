// apps/admin/test/setu-block-node.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
  it('auto-generates an enum <select> (seeded to default) + a text field, writing edits into mdAttrs', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness tag="notice" onReady={(g) => (getJSON = g)} />)
    const tone = await screen.findByLabelText('tone') as HTMLSelectElement
    expect(tone.value).toBe('info') // seeded to the enum default
    fireEvent.change(await screen.findByLabelText('title'), { target: { value: 'Good news' } })
    const json = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const block = json.content.find((n) => n.type === 'setuBlock')
    expect(block?.attrs?.mdAttrs?.title).toBe('Good news')
    expect(block?.attrs?.mdAttrs?.tone).toBeUndefined()
  })
  it('degrades to body-only (no form, no crash) when the tag has no registry entry', async () => {
    render(<Harness tag="ghost" onReady={() => {}} />)
    expect(await screen.findByText('ghost')).toBeInTheDocument() // label falls back to the tag
    expect(screen.queryByLabelText('tone')).toBeNull()
  })
  it('renders number input and checkbox for Number/Boolean attrs, writing correctly-typed values into mdAttrs', async () => {
    let getJSON: () => unknown = () => ({})
    render(<Harness tag="widget" onReady={(g) => (getJSON = g)} />)
    const countInput = await screen.findByLabelText('count') as HTMLInputElement
    const flagInput = await screen.findByLabelText('flag') as HTMLInputElement
    expect(countInput.type).toBe('number')
    expect(flagInput.type).toBe('checkbox')
    // Toggle the checkbox — should write a real boolean true
    fireEvent.click(flagInput)
    const json1 = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const block1 = json1.content.find((n) => n.type === 'setuBlock')
    expect(block1?.attrs?.mdAttrs?.flag).toBe(true) // must be boolean, not 'true'
    // Type into the number field — should write a real number
    fireEvent.change(countInput, { target: { value: '7' } })
    const json2 = getJSON() as { content: Array<{ type: string; attrs?: { mdAttrs?: Record<string, unknown> } }> }
    const block2 = json2.content.find((n) => n.type === 'setuBlock')
    expect(typeof block2?.attrs?.mdAttrs?.count).toBe('number')
    expect(block2?.attrs?.mdAttrs?.count).toBe(7)
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
    function Harness() {
      const editor = useEditor({
        immediatelyRender: false,
        extensions: [StarterKit, createSetuBlock([noticeBlock], { notice: Notice })],
        content: { type: 'doc', content: [{ type: 'setuBlock', attrs: { tag: 'notice', mdAttrs: { tone: 'success', title: 'Hi' } }, content: [{ type: 'paragraph' }] }] },
      })
      return <EditorContent editor={editor} />
    }
    const { container } = render(<Harness />)
    expect(await screen.findByText('Hi')).toBeInTheDocument()
    // the REAL core markup is in-canvas (not chrome):
    expect(container.querySelector('aside.notice.notice-success')).toBeTruthy()
    // the options form is still present:
    expect(screen.getByLabelText('tone')).toBeInTheDocument()
  })
})
