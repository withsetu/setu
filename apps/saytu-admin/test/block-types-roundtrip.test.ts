import { describe, it, expect } from 'vitest'
import { tiptapToMarkdoc, markdocToTiptap } from '@saytu/core'
import type { TiptapDoc } from '@saytu/core'

describe('structural block types round-trip', () => {
  it('H2/H3/H4 + lists + quote + code block survive tiptap → markdoc → tiptap', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Three' }] },
        { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Four' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'code()' }] },
      ],
    }
    const back = markdocToTiptap(tiptapToMarkdoc(doc))
    const types = (back.content ?? []).map((n) => n.type)
    expect(types).toEqual(['heading', 'heading', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock'])
    const levels = (back.content ?? []).filter((n) => n.type === 'heading').map((n) => n.attrs?.['level'])
    expect(levels).toEqual([2, 3, 4])
  })
})
