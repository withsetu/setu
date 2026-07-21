import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapNode } from '../src/index'

/** #785. The reader heals a literal `<br>` in a GFM cell into a `hardBreak` (#752/#769)
 *  — but it was doing so INSIDE code spans too. Markdoc hands a code span over as a
 *  text node carrying a `code` mark (to-tiptap's `code` case), and `splitCellBreaks`
 *  only skipped non-`text` nodes, so `` `a<br>b` `` came back as two code runs around a
 *  real break. Opening an entry and saving it then rewrote the cell to `` `a`<br>`b` ``,
 *  and the published page turned one `<code>` element into two — a mutation of content
 *  the author never touched.
 *
 *  Code-span content is literal by definition, which is exactly why the writer refuses
 *  to backslash-escape it (see escape-inline) and why the site renderer leaves a `<br>`
 *  inside `<code>` alone (its payload is an ATTRIBUTE, with no children to split). The
 *  reader now agrees with both. */
const rt = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

/** The inline run of the first body cell. */
const cellInline = (s: string): TiptapNode[] =>
  markdocToTiptap(s).content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]
    ?.content ?? []

describe('#785 — a <br> inside a code span in a cell', () => {
  const src = '| h |\n| --- |\n| `a<br>b` |\n'

  it('round-trips byte-identically', () => {
    expect(rt(src)).toBe(src)
    // and stays there
    expect(rt(rt(src))).toBe(src)
  })

  it('reads back as ONE code run holding the literal characters', () => {
    const inline = cellInline(src)
    expect(inline).toEqual([
      { type: 'text', text: 'a<br>b', marks: [{ type: 'code' }] }
    ])
  })

  it('still splits a <br> that is not in a code span (#769)', () => {
    const plain = '| h |\n| --- |\n| one<br>two |\n'
    expect(cellInline(plain).map((n) => n.type)).toEqual([
      'text',
      'hardBreak',
      'text'
    ])
    expect(rt(plain)).toBe(plain)
  })

  it('splits around a code span that has no break of its own', () => {
    const mixed = '| h |\n| --- |\n| one<br>`code`<br>two |\n'
    expect(cellInline(mixed).map((n) => n.type)).toEqual([
      'text',
      'hardBreak',
      'text',
      'hardBreak',
      'text'
    ])
    expect(rt(mixed)).toBe(mixed)
  })

  /** A break inside a NON-code mark keeps splitting, marks intact — and the writer
   *  respells the delimiters around each fragment (`**a**<br>**b**`). That first-save
   *  rewrite is #769's accepted behaviour, not a defect of this fix; it is pinned here
   *  so the fix cannot be widened into "skip every marked node". */
  it('still splits a break inside a non-code mark (#769)', () => {
    const bold = '| h |\n| --- |\n| **a<br>b** |\n'
    expect(cellInline(bold).map((n) => n.type)).toEqual([
      'text',
      'hardBreak',
      'text'
    ])
    const once = rt(bold)
    expect(once).toBe('| h |\n| --- |\n| **a**<br>**b** |\n')
    expect(rt(once)).toBe(once)
  })
})
