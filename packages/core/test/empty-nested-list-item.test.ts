import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

/** The child node types of the first list item of the first top-level node. */
const itemChildren = (s: string) =>
  markdocToTiptap(s).content[0]?.content?.[0]?.content?.map((n) => n.type)

/** #744 — an EMPTY nested list item was destroyed on save.
 *
 *  `listItemToMarkdoc` hugs a nested list to its parent item with a single `\n`
 *  (no blank line — that is what `Markdoc.format` emitted and what keeps ordinary
 *  nested lists byte-stable). An empty item is written as a bare marker. Compose
 *  the two and the nested list's only line is `  -` directly under the parent
 *  item's paragraph — and CommonMark forbids an EMPTY list item from interrupting
 *  a paragraph, so the marker is absorbed as a lazy continuation of `a`:
 *
 *    "- a\n\n\t*\n"   item children: [paragraph, bulletList]
 *      pass 1 "- a\n  -\n"     item children: [paragraph]   <- list GONE
 *      pass 2 "- a\n  \\-\n"   cemented, and non-converging
 *
 *  Trivially reachable from the editor: make a nested list, empty the item.
 *
 *  The repair is a blank line, and ONLY for the bare-marker line — an empty item
 *  cannot interrupt a paragraph in any spelling, so there is no re-spelling escape
 *  hatch of the #725 kind available here. It is scoped to that one shape so the
 *  three immune cases keep their exact current bytes: `taskList` (`- [ ]` is not
 *  empty), the top level and a blockquote (both already blank-line separated). */
describe('#744 an empty nested list item survives a save', () => {
  it('keeps an empty nested bulletList', () => {
    const source = '- a\n\n\t*\n'
    expect(itemChildren(source)).toEqual(['paragraph', 'bulletList'])
    const pass1 = roundtrip(source)
    expect(itemChildren(pass1)).toEqual(['paragraph', 'bulletList'])
    expect(roundtrip(pass1)).toBe(pass1)
  })

  it('keeps an empty nested orderedList', () => {
    const source = '- a\n\n\t1.\n'
    expect(itemChildren(source)).toEqual(['paragraph', 'orderedList'])
    const pass1 = roundtrip(source)
    expect(itemChildren(pass1)).toEqual(['paragraph', 'orderedList'])
    expect(roundtrip(pass1)).toBe(pass1)
  })

  it('keeps the blocks that FOLLOW the empty nested list', () => {
    const source = '- a\n\n\t*\n\n\tb\n'
    expect(itemChildren(source)).toEqual([
      'paragraph',
      'bulletList',
      'paragraph'
    ])
    const pass1 = roundtrip(source)
    expect(itemChildren(pass1)).toEqual([
      'paragraph',
      'bulletList',
      'paragraph'
    ])
    expect(roundtrip(pass1)).toBe(pass1)
  })

  // The immune cases. These assert BYTES, not just structure: the whole risk of
  // this fix is loosening a list that did not need it (#694), so an ordinary nested
  // list must come out of the writer character-for-character as it does today.
  it('leaves a NON-empty nested list hugged, byte-for-byte', () => {
    expect(roundtrip('- a\n  - b\n')).toBe('- a\n  - b\n')
    expect(roundtrip('- a\n  1. b\n')).toBe('- a\n  1. b\n')
    expect(roundtrip('1. a\n   - b\n')).toBe('1. a\n   - b\n')
  })

  it('leaves an empty nested TASK item hugged, byte-for-byte', () => {
    expect(roundtrip('- a\n  - [ ]\n')).toBe('- a\n  - [ ]\n')
  })

  it('leaves an empty item at the TOP LEVEL and in a blockquote unchanged', () => {
    expect(roundtrip('-\n')).toBe('-\n')
    expect(roundtrip('> -\n')).toBe('> -\n')
  })
})
