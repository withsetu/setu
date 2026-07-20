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
            'bulletList' | 'orderedList' | 'taskList'
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

/** #711 — a REGRESSION where the two fixes above meet. The empty-leading-paragraph
 *  drop (#652 x #658, directly above) was written for BULLET items and applied to task
 *  items too. For a bullet that is sound: the marker `- ` carries no text, so promoting
 *  the item's second child onto the marker line is exactly what CommonMark reads back.
 *
 *  A task item's marker line already carries the `[x] ` checkbox, which makes that line
 *  INLINE content — a heading, a table or a fence glued after it is re-read as literal
 *  paragraph text, so the block was destroyed on save:
 *
 *    task item [empty p, heading]   -> "- [ ] # x"  re-read as one paragraph
 *    task item [empty p, table]     -> never converged; collapsed to one line
 *    task item [empty p, codeBlock] -> never converged; mangled into escaped backticks
 *
 *  The drop's justification does not transfer either: an item that begins with a blank
 *  line is EMPTY in CommonMark, but a task item's first line is `- [ ]`, which is not
 *  blank — so keeping the empty paragraph is safe here and losing the block is not. */
describe('#711 task items keep a block that follows an empty first paragraph', () => {
  const emptyP: TiptapNode = { type: 'paragraph' }
  const taskDoc = (children: TiptapNode[]): TiptapDoc => ({
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          { type: 'listItem', attrs: { checked: false }, content: children }
        ]
      }
    ]
  })

  const heading: TiptapNode = {
    type: 'heading',
    attrs: { level: 1 },
    content: [{ type: 'text', text: 'x' }]
  }
  const codeBlock: TiptapNode = {
    type: 'codeBlock',
    attrs: { language: '' },
    content: [{ type: 'text', text: 'zz' }]
  }
  const table: TiptapNode = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [{ type: 'tableHeader', content: [p('a')] }]
      },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p('b')] }] }
    ]
  }

  /** The child kinds the item has after a save + re-read. */
  const itemChildren = (md: string): string[] => {
    const list = markdocToTiptap(md).content[0] as TiptapNode
    return (list.content?.[0]?.content ?? []).map((c) => c.type)
  }

  it.each([
    ['heading', heading, 'heading'],
    ['code block', codeBlock, 'codeBlock'],
    ['table', table, 'table']
  ])(
    'keeps a %s that follows an empty first paragraph',
    (_name, block, kind) => {
      const md = tiptapToMarkdoc(taskDoc([emptyP, block]))
      // The block must survive the save as a BLOCK, not as inline text glued to
      // the `[ ] ` marker — that is the shape the reader silently flattens.
      expect(itemChildren(md)).toContain(kind)
      // ...and it must still be inside the task item, not expelled to top level.
      expect(markdocToTiptap(md).content).toHaveLength(1)
    }
  )

  it.each([
    ['heading', heading],
    ['code block', codeBlock],
    ['table', table]
  ])('converges on the next save for a %s', (_name, block) => {
    const save1 = tiptapToMarkdoc(taskDoc([emptyP, block]))
    const save2 = tiptapToMarkdoc(markdocToTiptap(save1))
    expect(save2).toBe(save1)
  })

  it('keeps the checked state on the marker', () => {
    const md = tiptapToMarkdoc({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'listItem',
              attrs: { checked: true },
              content: [emptyP, heading]
            }
          ]
        }
      ]
    })
    expect(md.startsWith('- [x]')).toBe(true)
    const list = markdocToTiptap(md).content[0] as TiptapNode
    expect(list.content?.[0]?.attrs?.['checked']).toBe(true)
  })

  // The CONTROL: a bullet item must still drop the empty paragraph. If this starts
  // emitting "-\n\n  # x" the #652 x #658 fix above has been undone.
  it('still drops the empty first paragraph for a bullet item', () => {
    expect(tiptapToMarkdoc(listDoc('bulletList', [[emptyP, heading]]))).toBe(
      '- # x\n'
    )
  })

  // The drop is about what can occupy the MARKER LINE, not about the kind of list.
  // A paragraph can sit after `[ ] `, so promoting it is still both safe and the
  // tidier output — a task item should not be forced onto three lines just because
  // the editor left an empty first paragraph.
  it('still drops the empty first paragraph when the next child is a paragraph', () => {
    expect(tiptapToMarkdoc(taskDoc([emptyP, p('a')]))).toBe('- [ ] a\n')
  })

  // The other half of the same invariant, reached from the opposite side: a task item
  // with NO leading paragraph at all. The `paragraph block*` schema does not produce
  // this, but nothing in the serializer depends on the schema holding, and gluing the
  // block onto `[ ] ` flattens it exactly as the dropped-paragraph case did.
  it('does not glue a non-paragraph first child onto the marker', () => {
    const md = tiptapToMarkdoc(taskDoc([heading]))
    expect(md).toBe('- [ ]\n\n  # x\n')
    expect(itemChildren(md)).toContain('heading')
  })
})

/** #725. `to-markdoc` used to normalise every bullet marker to `-`. A list item whose
 *  first child is a thematic break was therefore written as `- ---`, and CommonMark
 *  reads a line of `-` and spaces as a THEMATIC BREAK before it ever considers a list:
 *  the two-item list came back as a top-level `<hr>` plus a one-item list. The item's
 *  content was not merely reordered, it left the list.
 *
 *  This is the same class as #711 (a block promoted onto a marker line that cannot
 *  carry it) reached from the bullet side, which #711 believed was immune.
 *
 *  Since #694 the bullet marker is no longer always `-` — it alternates `-`/`*` across
 *  adjacent sibling lists — so the guard can no longer assume which character it is
 *  defending against. That is why `fusesWithMarkerLine` takes the PREFIX rather than
 *  hard-coding `- `, and why the respelling `.find` re-tests every candidate: under a
 *  `*` marker the fusing spelling is `***`, not `---`, and the repair has to flip the
 *  other way. The last case below is that composition. */
describe('#725 a thematic break as a list item first child stays in the list', () => {
  const hr: TiptapNode = { type: 'horizontalRule' }
  const topLevel = (md: string) =>
    (markdocToTiptap(md).content ?? []).map((n) => n.type)
  /** The child kinds the FIRST item has after a save + re-read. */
  const itemChildren = (md: string): string[] => {
    const list = markdocToTiptap(md).content[0] as TiptapNode
    return (list.content?.[0]?.content ?? []).map((c) => c.type)
  }

  it('does not emit a marker line that re-reads as a thematic break', () => {
    const md = tiptapToMarkdoc(listDoc('bulletList', [[hr], [p('a')]]))
    expect(md).not.toContain('- ---')
    expect(topLevel(md)).toEqual(['bulletList'])
    expect(itemChildren(md)).toContain('horizontalRule')
  })

  it('round-trips the source shape that first exposed it', () => {
    const once = tiptapToMarkdoc(markdocToTiptap('* ---\n* a\n'))
    expect(topLevel(once)).toEqual(['bulletList'])
    // …and is a fixed point from there: no further drift on later saves.
    expect(tiptapToMarkdoc(markdocToTiptap(once))).toBe(once)
  })

  it('is reachable through the `_` spelling too', () => {
    const once = tiptapToMarkdoc(markdocToTiptap('- ___\n- a\n'))
    expect(topLevel(once)).toEqual(['bulletList'])
    expect(tiptapToMarkdoc(markdocToTiptap(once))).toBe(once)
  })

  it('keeps a lone thematic-break item inside its list', () => {
    const md = tiptapToMarkdoc(listDoc('bulletList', [[hr]]))
    expect(topLevel(md)).toEqual(['bulletList'])
  })

  /** The controls: shapes that were already stable and must not move. An ordered
   *  marker and a task marker cannot fuse with a `-`/`_`/`*` run, and a top-level
   *  thematic break keeps its canonical `---` spelling. */
  it('leaves the non-fusing markers and the top-level rule untouched', () => {
    expect(tiptapToMarkdoc(listDoc('orderedList', [[hr], [p('a')]]))).toBe(
      '1. ---\n1. a\n'
    )
    expect(tiptapToMarkdoc({ type: 'doc', content: [hr] })).toBe('---\n')
    expect(tiptapToMarkdoc(markdocToTiptap('- # h\n- a\n'))).toBe(
      '- # h\n- a\n'
    )
    expect(tiptapToMarkdoc(markdocToTiptap('> ---\n'))).toBe('> ---\n')
    expect(tiptapToMarkdoc(markdocToTiptap('- a\n\n  ---\n'))).toBe(
      '- a\n\n  ---\n'
    )
    expect(tiptapToMarkdoc(markdocToTiptap('- [ ] ---\n'))).toBe('- [ ] ---\n')
  })

  /** #694 x #725 — the composition, which neither round could test alone. #694 picks
   *  the item's MARKER from sibling position; #725 respells the marker line's CONTENT.
   *  Both act on the same emitted line, so the guard must run against the marker that
   *  is actually written, not the `-` it used to be able to assume.
   *
   *  A second adjacent list takes the `*` marker. `* ---` does NOT fuse (the run has
   *  to be all one character), so the rule keeps its canonical spelling there — the
   *  mirror image of the `- ***` the first list needs. Getting this backwards emits a
   *  line that re-reads as a thematic break and silently drops a list. */
  it('respells against the alternated marker, not a hard-coded `-`', () => {
    const src = '- a\n\n* ---\n* b\n'
    const once = tiptapToMarkdoc(markdocToTiptap(src))
    expect(once).toBe('- a\n\n* ---\n* b\n')
    expect(topLevel(once)).toEqual(['bulletList', 'bulletList'])
    expect(tiptapToMarkdoc(markdocToTiptap(once))).toBe(once)
    // ...and in the same document the FIRST list, which takes `-`, still respells to
    // `- ***`. Built structurally: `- ---` cannot be written as source, because it
    // already reads as a thematic break — that is the defect, seen from the read side.
    const twoLists = tiptapToMarkdoc({
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [hr] }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [p('c')] }]
        }
      ]
    })
    expect(twoLists).toBe('- ***\n\n* c\n')
    expect(topLevel(twoLists)).toEqual(['bulletList', 'bulletList'])
    expect(tiptapToMarkdoc(markdocToTiptap(twoLists))).toBe(twoLists)
  })
})
