import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc, TiptapNode } from '../src/index'

/** #784. An ATX heading is ONE physical line in Markdown, so heading content has no
 *  serialization for a line break — the previous writer let a `hardBreak` escape as a
 *  real newline and CORRUPTED the document:
 *
 *    heading(2)[ "one", hardBreak, "two" ]  ->  "## one\\\ntwo\n"
 *                                          ->  heading "one\"  +  paragraph "two"
 *
 *  A trailing backslash was left glued to the heading text and a stray paragraph
 *  appeared, on a document the author never restructured. It is reachable in the
 *  editor: `@tiptap/extension-heading` is `content: "inline*"` and hard-break binds
 *  Shift-Enter globally.
 *
 *  The writer now FOLDS the break to a single space. That is lossy — the break is
 *  gone — and deliberately so: there is no correct single-line spelling to preserve
 *  it (a literal `<br>` would need reader AND renderer halves for a construct that
 *  Markdown does not have), and losing a break beats losing the heading. The same
 *  fold covers a raw `\n` inside a heading text node, which is the identical defect
 *  arriving through the #667 soft-break representation.
 *
 *  Editor-side prevention (stopping Shift-Enter from making the break at all) is a
 *  separate, additive concern — see the follow-up issue; the writer must be safe
 *  regardless, because core is a port and takes Tiptap JSON from any caller. */
const doc = (content: TiptapNode[]): TiptapDoc =>
  ({ type: 'doc', content }) as TiptapDoc

const heading = (content: TiptapNode[]): TiptapDoc =>
  doc([{ type: 'heading', attrs: { level: 2 }, content }])

/** Node types of the reread document's top level. */
const topTypes = (md: string): string[] =>
  (markdocToTiptap(md).content ?? []).map((n) => n.type)

describe('#784 — a heading is a single line', () => {
  it('folds a hard break to a space instead of splitting the heading', () => {
    const md = tiptapToMarkdoc(
      heading([
        { type: 'text', text: 'one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'two' }
      ])
    )
    expect(md).toBe('## one two\n')
    expect(topTypes(md)).toEqual(['heading'])
    // Byte-stable: the folded output is already canonical.
    expect(tiptapToMarkdoc(markdocToTiptap(md))).toBe(md)
  })

  it('keeps the heading whole when the break sits inside a mark', () => {
    const md = tiptapToMarkdoc(
      heading([
        { type: 'text', text: 'one', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'two', marks: [{ type: 'bold' }] }
      ])
    )
    expect(md).toBe('## **one two**\n')
    expect(topTypes(md)).toEqual(['heading'])
  })

  it('folds a raw newline in a heading text node too', () => {
    const md = tiptapToMarkdoc(heading([{ type: 'text', text: 'one\ntwo' }]))
    expect(md).toBe('## one two\n')
    expect(topTypes(md)).toEqual(['heading'])
  })

  it('drops a leading/trailing break rather than emitting stray padding', () => {
    const md = tiptapToMarkdoc(
      heading([
        { type: 'hardBreak' },
        { type: 'text', text: 'one' },
        { type: 'hardBreak' }
      ])
    )
    expect(md).toBe('## one\n')
    expect(tiptapToMarkdoc(markdocToTiptap(md))).toBe(md)
  })

  it('does not double the space when the text already ends with one', () => {
    const md = tiptapToMarkdoc(
      heading([
        { type: 'text', text: 'one ' },
        { type: 'hardBreak' },
        { type: 'text', text: 'two' }
      ])
    )
    expect(md).toBe('## one two\n')
  })

  it('leaves a paragraph hard break alone', () => {
    const md = tiptapToMarkdoc(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'two' }
          ]
        }
      ])
    )
    expect(md).toBe('one\\\ntwo\n')
    expect(markdocToTiptap(md).content?.[0]?.content?.[1]?.type).toBe(
      'hardBreak'
    )
  })

  it('keeps an image in a heading (the fold is breaks only)', () => {
    const md = tiptapToMarkdoc(
      heading([
        { type: 'text', text: 'a ' },
        { type: 'image', attrs: { src: '/x.png', alt: 'x' } }
      ])
    )
    expect(md).toBe('## a ![x](/x.png)\n')
  })
})
