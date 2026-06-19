// apps/admin/test/setu-block-node.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { z } from 'zod'
import type { ResolvedBlock } from '@setu/core'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'

afterEach(cleanup)

const notice: ResolvedBlock = {
  tag: 'notice',
  props: z.object({ tone: z.enum(['info', 'warn', 'success']).default('info'), title: z.string().optional() }),
  component: 'blocks/notice/notice.astro',
  editor: { label: 'Notice', icon: 'info' },
}

function Harness({ tag, onReady }: { tag: string; onReady: (getJSON: () => unknown) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, createSetuBlock([notice])],
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
  })
  it('degrades to body-only (no form, no crash) when the tag has no registry entry', async () => {
    render(<Harness tag="ghost" onReady={() => {}} />)
    expect(await screen.findByText('ghost')).toBeInTheDocument() // label falls back to the tag
    expect(screen.queryByLabelText('tone')).toBeNull()
  })
})
