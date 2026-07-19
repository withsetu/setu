import { describe, it, expect } from 'vitest'
import { tiptapToMarkdoc, markdocToTiptap } from '../src/index'
import type { TiptapDoc, TiptapNode } from '../src/index'

describe('tiptapToMarkdoc', () => {
  it('serializes a heading', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Hello' }]
        }
      ]
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
            { type: 'text', text: 'i', marks: [{ type: 'italic' }] }
          ]
        }
      ]
    }
    expect(tiptapToMarkdoc(doc)).toBe('**b** *i*\n')
  })

  // #653: the `code` arm ASSIGNED `n` instead of wrapping `[n]`, so it discarded every
  // mark applied before it. to-tiptap emits `code` last in the mark list, so the link
  // (or bold/italic/strike) was built first and then thrown away — silent data loss.
  describe('a code mark keeps its sibling marks (#653)', () => {
    const para = (marks: { type: string; attrs?: Record<string, unknown> }[]) =>
      ({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'api', marks }] }
        ]
      }) satisfies TiptapDoc

    it('keeps the href of a linked code span', () => {
      expect(
        tiptapToMarkdoc(
          para([
            { type: 'link', attrs: { href: 'https://example.com' } },
            { type: 'code' }
          ])
        )
      ).toBe('[`api`](https://example.com)\n')
    })

    it('keeps bold around a code span', () => {
      expect(tiptapToMarkdoc(para([{ type: 'bold' }, { type: 'code' }]))).toBe(
        '**`api`**\n'
      )
    })

    it('keeps italic and strike around a code span', () => {
      expect(tiptapToMarkdoc(para([{ type: 'italic' }, { type: 'code' }]))).toBe(
        '*`api`*\n'
      )
      expect(tiptapToMarkdoc(para([{ type: 'strike' }, { type: 'code' }]))).toBe(
        '~~`api`~~\n'
      )
    })

    it('round-trips the mark set in both directions', () => {
      const src = '[`api`](https://example.com)\n'
      const doc = markdocToTiptap(src)
      const text = doc.content[0]!.content![0]!
      expect(text.marks).toEqual([
        { type: 'link', attrs: { href: 'https://example.com' } },
        { type: 'code' }
      ])
      expect(tiptapToMarkdoc(doc)).toBe(src)

      const bold = '**`api`**\n'
      const boldDoc = markdocToTiptap(bold)
      expect(boldDoc.content[0]!.content![0]!.marks).toEqual([
        { type: 'bold' },
        { type: 'code' }
      ])
      expect(tiptapToMarkdoc(boldDoc)).toBe(bold)
    })
  })

  // #665: unrecognized nodes serialized to an empty paragraph and unrecognized marks
  // were silently ignored, so a schema/serializer drift lost content with no signal.
  // The module already takes the right posture for setuBlock (throws on a missing tag).
  describe('unknown nodes and marks fail loudly (#665)', () => {
    it('throws on an unrecognized block node type', () => {
      expect(() =>
        tiptapToMarkdoc({
          type: 'doc',
          content: [{ type: 'unknownNodeType' }]
        })
      ).toThrow(/unknownNodeType/)
    })

    it('throws on an unrecognized mark type', () => {
      expect(() =>
        tiptapToMarkdoc({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'x', marks: [{ type: 'underline' }] }
              ]
            }
          ]
        })
      ).toThrow(/underline/)
    })

    it('still serializes every mark the editor can actually produce', () => {
      const marks = [
        'bold',
        'italic',
        'strike',
        'code',
        'subscript',
        'superscript'
      ]
      for (const type of marks) {
        expect(() =>
          tiptapToMarkdoc({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'x', marks: [{ type }] }]
              }
            ]
          })
        ).not.toThrow()
      }
    })
  })

  // Prerequisite for the #665 throw: these three block types are `group: 'block'` and
  // so are schema-valid inside a blockquote, but buildBlock had no case for them —
  // they hit the default arm and were destroyed ("> > \n> > \n"). Routing blockquote
  // bodies through the string-level serializer preserves them AND keeps the default
  // arm reachable only by genuinely unknown types.
  describe('blockquote preserves string-serialized children (#665)', () => {
    it('keeps a table, an imageBlock and a passthrough nested in a blockquote', () => {
      const out = tiptapToMarkdoc({
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'note' }] },
              {
                type: 'imageBlock',
                attrs: { mdAttrs: { src: '/a.png', alt: 'a' } }
              },
              { type: 'passthrough', attrs: { raw: '{% weird %}' } }
            ]
          }
        ]
      })
      expect(out).toBe(
        '> note\n> \n> {% image src="/a.png" alt="a" /%}\n> \n> {% weird %}\n'
      )
    })

    it('leaves a plain blockquote byte-identical', () => {
      expect(
        tiptapToMarkdoc({
          type: 'doc',
          content: [
            {
              type: 'blockquote',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'line one' }]
                },
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'line two' }]
                }
              ]
            }
          ]
        })
      ).toBe('> line one\n> \n> line two\n')
    })
  })

  it('emits passthrough raw verbatim', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'passthrough',
          attrs: { raw: '{% if $x %}\nHi\n{% /if %}', flagged: false }
        }
      ]
    }
    expect(tiptapToMarkdoc(doc)).toBe('{% if $x %}\nHi\n{% /if %}\n')
  })

  it('serializes an imageBlock non-primitive mdAttr via JSON.stringify, never "[object Object]"', () => {
    const md = tiptapToMarkdoc({
      type: 'doc',
      content: [
        {
          type: 'imageBlock',
          attrs: {
            mdAttrs: {
              src: '/media/2026/07/photo.jpg',
              alt: 'A photo',
              focalPoint: { x: 0.5, y: 0.25 }
            }
          }
        }
      ]
    })
    expect(md).not.toContain('[object Object]')
    expect(md).toBe(
      '{% image src="/media/2026/07/photo.jpg" alt="A photo" focalPoint="{\\"x\\":0.5,\\"y\\":0.25}" /%}\n'
    )
  })

  it('serializes a contactBlock back to a {% contact %} tag and round-trips its attrs', () => {
    const md = tiptapToMarkdoc({
      type: 'doc',
      content: [
        {
          type: 'contactBlock',
          attrs: {
            mdAttrs: { formId: 'c-1', subject: true, successMessage: 'Thanks' }
          }
        }
      ]
    })
    expect(md).toContain('{% contact')
    const back = markdocToTiptap(md, { knownBlockTags: new Set(['contact']) })
    expect(back.content[0]!.type).toBe('contactBlock')
    expect(
      (back.content[0]!.attrs as { mdAttrs: Record<string, unknown> }).mdAttrs
    ).toMatchObject({
      formId: 'c-1',
      subject: true,
      successMessage: 'Thanks'
    })
  })
})

describe('task lists + nesting (tiptapToMarkdoc)', () => {
  const wrap = (node: TiptapNode) =>
    tiptapToMarkdoc({ type: 'doc', content: [node] })

  it('serializes a taskList with [ ]/[x] markers', () => {
    const md = wrap({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }
          ]
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'done' }] }
          ]
        }
      ]
    })
    expect(md).toBe('- [ ] todo\n- [x] done\n')
  })

  it('keeps inner marks after the marker', () => {
    const md = wrap({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'do the ' },
                { type: 'text', text: 'thing', marks: [{ type: 'bold' }] }
              ]
            }
          ]
        }
      ]
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
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'b' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
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
            {
              type: 'taskList',
              content: [
                {
                  type: 'taskItem',
                  attrs: { checked: true },
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'sub' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    expect(md).toBe('- parent\n  - [x] sub\n')
  })
})

describe('text alignment (tiptapToMarkdoc)', () => {
  const wrap = (node: TiptapNode) =>
    tiptapToMarkdoc({ type: 'doc', content: [node] })

  it('writes a centered paragraph as a node annotation', () => {
    const md = wrap({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: 'Centered' }]
    })
    expect(md).toBe('Centered{% align="center" %}\n')
  })

  it('writes a right-aligned heading', () => {
    const md = wrap({
      type: 'heading',
      attrs: { level: 2, textAlign: 'right' },
      content: [{ type: 'text', text: 'Title' }]
    })
    expect(md).toBe('## Title{% align="right" %}\n')
  })

  it('keeps alignment annotation after inline marks', () => {
    const md = wrap({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'a ' },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] }
      ]
    })
    expect(md).toBe('a **b**{% align="center" %}\n')
  })

  it('emits NO annotation for left/absent alignment', () => {
    expect(
      wrap({
        type: 'paragraph',
        attrs: { textAlign: 'left' },
        content: [{ type: 'text', text: 'x' }]
      })
    ).toBe('x\n')
    expect(
      wrap({ type: 'paragraph', content: [{ type: 'text', text: 'y' }] })
    ).toBe('y\n')
  })
})
