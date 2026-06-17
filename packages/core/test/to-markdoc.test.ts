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

describe('task lists + nesting (tiptapToMarkdoc)', () => {
  const wrap = (node: any) => tiptapToMarkdoc({ type: 'doc', content: [node] })

  it('serializes a taskList with [ ]/[x] markers', () => {
    const md = wrap({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
      ],
    })
    expect(md).toBe('- [ ] todo\n- [x] done\n')
  })

  it('keeps inner marks after the marker', () => {
    const md = wrap({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'do the ' },
          { type: 'text', text: 'thing', marks: [{ type: 'bold' }] },
        ] }] },
      ],
    })
    expect(md).toBe('- [ ] do the **thing**\n')
  })

  it('serializes a nested bullet list inside an item', () => {
    const md = wrap({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
          ],
        },
      ],
    })
    expect(md).toBe('- a\n  - b\n')
  })

  it('serializes a nested checklist under a bullet (mixed)', () => {
    const md = wrap({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sub' }] }] }] },
          ],
        },
      ],
    })
    expect(md).toBe('- parent\n  - [x] sub\n')
  })
})
