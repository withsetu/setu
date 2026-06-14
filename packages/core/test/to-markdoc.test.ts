import { describe, it, expect } from 'vitest'
import { tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc } from '../src/index'

describe('tiptapToMarkdoc', () => {
  it('serializes a heading', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] }],
    }
    expect(tiptapToMarkdoc(doc)).toBe('## Hello\n')
  })

  it('serializes bold and italic marks', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    }
    expect(tiptapToMarkdoc(doc)).toBe('**b** *i*\n')
  })

  it('emits passthrough raw verbatim', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'passthrough', attrs: { raw: '{% if $x %}\nHi\n{% /if %}', flagged: false } }],
    }
    expect(tiptapToMarkdoc(doc)).toBe('{% if $x %}\nHi\n{% /if %}\n')
  })
})
