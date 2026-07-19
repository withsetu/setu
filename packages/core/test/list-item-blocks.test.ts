import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { tiptapToMarkdoc, markdocToTiptap } from '../src/index'
import type { TiptapDoc, TiptapNode } from '../src/index'

const p = (text: string): TiptapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }]
})
const listDoc = (
  type: 'bulletList' | 'orderedList' | 'taskList',
  items: TiptapNode[][]
): TiptapDoc => ({
  type: 'doc',
  content: [
    {
      type: type,
      content: items.map((content) => ({ type: 'listItem', content }))
    }
  ]
})

/** #658 (second half): `buildListItem` kept only the FIRST paragraph plus nested
 *  lists, so a second paragraph, a table, an image or a code block inside a list
 *  item was destroyed on save without a word. The Tiptap `listItem` schema is
 *  `paragraph block*`, so all of these are reachable — a paste is enough. */
describe('#658 list items keep every block child', () => {
  it('keeps a second paragraph', () => {
    const md = tiptapToMarkdoc(listDoc('bulletList', [[p('one'), p('two')]]))
    expect(md).toContain('one')
    expect(md).toContain('two')
  })

  it('keeps a code block inside a list item', () => {
    const md = tiptapToMarkdoc(
      listDoc('bulletList', [
        [
          p('run this'),
          {
            type: 'codeBlock',
            attrs: { language: 'js' },
            content: [{ type: 'text', text: 'const x = 1' }]
          }
        ]
      ])
    )
    expect(md).toContain('run this')
    expect(md).toContain('const x = 1')
  })

  it('keeps an imageBlock inside a list item', () => {
    const md = tiptapToMarkdoc(
      listDoc('bulletList', [
        [
          p('see'),
          {
            type: 'imageBlock',
            attrs: { mdAttrs: { src: '/media/a.png', alt: 'A' } }
          }
        ]
      ])
    )
    expect(md).toContain('see')
    expect(md).toContain('/media/a.png')
  })

  it('keeps a table inside a list item', () => {
    const md = tiptapToMarkdoc(
      listDoc('bulletList', [
        [
          p('data'),
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [p('h1')] },
                  { type: 'tableHeader', content: [p('h2')] }
                ]
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [p('c1')] },
                  { type: 'tableCell', content: [p('c2')] }
                ]
              }
            ]
          }
        ]
      ])
    )
    for (const t of ['data', 'h1', 'h2', 'c1', 'c2']) expect(md).toContain(t)
  })

  it('keeps a blockquote inside a list item (both string-level serializers compose)', () => {
    const md = tiptapToMarkdoc(
      listDoc('bulletList', [
        [p('quoting'), { type: 'blockquote', content: [p('quoted line')] }]
      ])
    )
    expect(md).toContain('quoting')
    expect(md).toContain('quoted line')
  })

  it('keeps extra blocks in an ordered list item', () => {
    const md = tiptapToMarkdoc(listDoc('orderedList', [[p('step'), p('note')]]))
    expect(md).toContain('step')
    expect(md).toContain('note')
  })

  it('keeps extra blocks in a task list item, marker intact', () => {
    const md = tiptapToMarkdoc({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'listItem',
              attrs: { checked: true },
              content: [p('done'), p('detail')]
            }
          ]
        }
      ]
    })
    expect(md).toContain('[x] done')
    expect(md).toContain('detail')
  })

  it('round-trips a multi-block list item back through markdocToTiptap', () => {
    const doc = listDoc('bulletList', [[p('one'), p('two')]])
    const md = tiptapToMarkdoc(doc)
    const back = markdocToTiptap(md)
    expect(JSON.stringify(back)).toContain('two')
    expect(tiptapToMarkdoc(back)).toBe(md)
  })

  // Byte-stability guard: the string-level list serializer must emit exactly what
  // Markdoc.format did for the ordinary shapes, or every existing file with a list
  // gets rewritten on its next save.
  it('is byte-stable for simple and nested lists', () => {
    expect(
      tiptapToMarkdoc(
        listDoc('bulletList', [
          [p('one')],
          [
            p('two'),
            {
              type: 'bulletList',
              content: [{ type: 'listItem', content: [p('nested')] }]
            }
          ]
        ])
      )
    ).toBe('- one\n- two\n  - nested\n')
    expect(tiptapToMarkdoc(listDoc('orderedList', [[p('a')], [p('b')]]))).toBe(
      '1. a\n1. b\n'
    )
    expect(
      tiptapToMarkdoc({
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'listItem',
                attrs: { checked: true },
                content: [p('done')]
              },
              {
                type: 'listItem',
                attrs: { checked: false },
                content: [p('todo')]
              }
            ]
          }
        ]
      })
    ).toBe('- [x] done\n- [ ] todo\n')
  })
})

/** Generalises past this one bug: whatever the document shape, serialization must
 *  never silently lose a leaf. Both halves of #658 and #665 would have failed here. */
describe('#658 property: tiptapToMarkdoc never drops a leaf', () => {
  const word = fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 3,
      maxLength: 8
    })
    .map((a) => a.join(''))

  const leafBlock = (text: string): fc.Arbitrary<TiptapNode> =>
    fc.oneof(
      fc.constant<TiptapNode>({
        type: 'paragraph',
        content: [{ type: 'text', text }]
      }),
      fc.constant<TiptapNode>({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text }]
      }),
      fc.constant<TiptapNode>({
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text }]
      }),
      fc.constant<TiptapNode>({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      })
    )

  /** A doc whose every leaf text is a distinct word, so "did it survive?" is a
   *  simple substring check on the serialized output. */
  const docArb: fc.Arbitrary<{ doc: TiptapDoc; words: string[] }> = fc
    .uniqueArray(word, { minLength: 1, maxLength: 6 })
    .chain((words) =>
      fc
        .tuple(
          ...words.map((w) => leafBlock(w)),
          fc.constantFrom(
            'bulletList' as const,
            'orderedList' as const,
            'taskList' as const
          )
        )
        .map((parts) => {
          const listType = parts[parts.length - 1] as
            | 'bulletList'
            | 'orderedList'
            | 'taskList'
          const blocks = parts.slice(0, -1) as TiptapNode[]
          // Everything after the first block lives INSIDE one list item — exactly
          // the position #658 destroyed.
          const [first, ...rest] = blocks
          const doc: TiptapDoc = {
            type: 'doc',
            content: [
              {
                type: listType,
                content: [
                  {
                    type: 'listItem',
                    attrs: { checked: false },
                    content: [
                      first?.type === 'paragraph'
                        ? first
                        : { type: 'paragraph', content: [] },
                      ...(first && first.type !== 'paragraph' ? [first] : []),
                      ...rest
                    ]
                  }
                ]
              }
            ]
          }
          return { doc, words }
        })
    )

  it('every leaf text of the input appears in the output', () => {
    fc.assert(
      fc.property(docArb, ({ doc, words }) => {
        const md = tiptapToMarkdoc(doc)
        for (const w of words) expect(md).toContain(w)
      })
    )
  })
})

/** The seam between the two halves of this slice: origin/main's string-level list
 *  serializer (#658, above) and this branch's position-dependent escaping contract
 *  (#652/#676, ./escape-inline.ts). `buildListItem` used to pass the position
 *  explicitly; folding every item child through `serializeBlock` means the position
 *  now has to be threaded, and a mechanical merge silently drops it in one direction
 *  or the other. Each case below pins one position. */
describe('#652 x #658: escape position inside a list item', () => {
  const rt = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

  // A plain bullet's text IS at a block start: "- # x" would be a heading inside
  // the item, so the escape must survive. Position: `block-start`.
  it.each([
    ['heading marker', '- \\# not a heading\n'],
    ['blockquote marker', '- \\> not a quote\n'],
    ['bullet marker', '- \\- not a bullet\n']
  ])('keeps a bullet item %s escaped', (_name, src) => {
    expect(rt(src)).toBe(src)
  })

  // A task item's text follows the "[x] " marker, so it is NOT at a block start and
  // must NOT gain an escape — otherwise every existing task list is rewritten on its
  // next save. Position: `after-inline-marker`.
  it.each([
    ['heading marker', '- [x] # a\n'],
    ['blockquote marker', '- [ ] > b\n'],
    ['bullet marker', '- [x] - c\n']
  ])('leaves a task item %s unescaped', (_name, src) => {
    expect(rt(src)).toBe(src)
  })

  // A SECOND paragraph sits on its own indented line, so it is at a block start in
  // its own right even though the item's first paragraph was not the whole story.
  it('escapes a block marker in a list item second paragraph', () => {
    const src = '- one\n\n  \\# not a heading\n'
    expect(rt(src)).toBe(src)
  })

  // Only reachable once both halves are merged: the widened alphabet generates "#"
  // inside a bullet, and the string-level serializer is what writes multi-block items.
  // An empty leading paragraph must not be written, or the blank line after the marker
  // makes CommonMark read the item as empty and expel the heading out of the list.
  it('does not expel later children when the first paragraph is empty', () => {
    const once = rt('- #\n')
    expect(once).toBe('- # \n')
    expect(rt(once)).toBe(once)
  })
})
