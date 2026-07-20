import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapNode } from '../src/index'

const rt = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

/** The mark types on each inline run of the document's first block. */
const runMarks = (md: string): string[][] => {
  const first = markdocToTiptap(md).content[0] as TiptapNode
  return (first.content ?? []).map((n) => (n.marks ?? []).map((m) => m.type))
}

/** #693 — the unfinished half of #653.
 *
 *  #653 correctly made a code run CARRY its sibling marks in the model, so
 *  `*a `b` c*` reads as three runs that all have `italic`, the middle one also
 *  having `code`. `buildInline` then wrapped EVERY run in its own delimiter pair
 *  and never merged adjacent runs sharing a mark, so the emphasis was re-emitted
 *  three times over:
 *
 *    *a `b` c*    -> *a**`b`**c*      -> *a*\*`b`\**c*    italic LOST
 *    **a `b` c**  -> **a****`b`****c**                    bold LOST
 *    ~~a `b` c~~  -> ~~a~~~~`b`~~~~c~~                    strike LOST
 *
 *  The doubled delimiter re-parses as a literal `**` rather than as emphasis, so
 *  the mark is dropped AND a literal asterisk pair is rendered — and the file never
 *  converges, because the next save escapes the stray delimiters.
 *
 *  The fix merges adjacent runs sharing a mark BEFORE wrapping, so one delimiter
 *  pair spans the whole run. Marker alternation (`*` vs `_`) was rejected earlier as
 *  only conditionally safe, and an HTML-comment separator as non-idempotent. */
describe('#693 adjacent inline runs sharing a mark emit one delimiter pair', () => {
  it.each([
    ['emphasis around code', '*a `b` c*\n'],
    ['strong around code', '**a `b` c**\n'],
    ['strike around code', '~~a `b` c~~\n'],
    ['emphasis around a link', '*a [b](https://example.com) c*\n'],
    ['strong spanning two code spans', '**a `b` c `d` e**\n']
  ])('round-trips %s byte-for-byte', (_name, src) => {
    expect(rt(src)).toBe(src)
  })

  it.each([
    ['italic', '*a `b` c*\n'],
    ['bold', '**a `b` c**\n'],
    ['strike', '~~a `b` c~~\n']
  ])('keeps the %s mark on every run after a save', (mark, src) => {
    // Every run of the ORIGINAL carries the mark...
    expect(runMarks(src).every((m) => m.includes(mark))).toBe(true)
    // ...and still does after a round-trip. This is the assertion that fails on the
    // doubled-delimiter output: `*a**`b`**c*` re-reads with the mark on `a` only.
    expect(runMarks(rt(src)).every((m) => m.includes(mark))).toBe(true)
  })

  it('does not emit a literal delimiter pair into the output', () => {
    // The corrupted form is recognisable on its own: `**` immediately after a
    // single-`*` emphasis close, with no whitespace, is the defect's signature.
    expect(rt('*a `b` c*\n')).not.toContain('**')
    expect(rt('~~a `b` c~~\n')).not.toContain('~~~~')
  })

  it('converges after one save', () => {
    for (const src of ['*a `b` c*\n', '**a `b` c**\n', '~~a `b` c~~\n']) {
      const save1 = rt(src)
      expect(rt(save1)).toBe(save1)
    }
  })

  // Controls that already passed — the code span is the WHOLE content, so no
  // adjacency exists and no merging is required. These pin that the fix does not
  // change the shapes that were already correct.
  it.each([
    ['code span as the whole link text', '[`api`](https://example.com)\n'],
    ['code span as the whole emphasis', '*`api`*\n'],
    ['code span as the whole strong', '**`api`**\n'],
    ['plain emphasis', '*plain emph*\n'],
    ['plain strong', '**plain strong**\n'],
    ['adjacent runs with DIFFERENT marks', '*a***b**\n']
  ])('leaves %s unchanged', (_name, src) => {
    expect(rt(src)).toBe(src)
  })

  /** Surfaced by returning `*` to the property generator's alphabet (#712), and a
   *  precondition for keeping it there — at ~1 failure in 200,000 documents it is a
   *  live CI flake, not a curiosity.
   *
   *  CommonMark nests identical emphasis: `_a*a*_` is em(text, em(text)). The reader
   *  descended that tree appending a mark per level, so the inner run came out with
   *  `italic` TWICE. A ProseMirror mark set is a SET — the editor itself collapses the
   *  duplicate on load — so that array was model state Tiptap can never hold, and the
   *  writer duly wrapped the run in two `*` pairs: `_a*a*_` -> `*a*a**`, whose trailing
   *  `**` re-parses as a literal asterisk pair. Same delimiter-run corruption as #693,
   *  reached from the reader rather than the writer.
   *
   *  Deduplicating on the way in matches what the editor would store anyway. The
   *  redundant nesting is dropped; no text and no mark is lost. */
  it.each([
    ['nested identical emphasis', '_a*a*_\n', '*aa*\n'],
    ['nested identical emphasis, leading', '_*a*a_\n', '*aa*\n'],
    ['nested identical strong', '__a**a**__\n', '**aa**\n']
  ])(
    'collapses %s rather than doubling the delimiter',
    (_name, src, expected) => {
      // One delimiter pair over the merged run — not two, and no stray literal.
      expect(rt(src)).toBe(expected)
      // Converges immediately. The defect needed a second pass to settle, and
      // corrupted the mark on the way there.
      expect(rt(expected)).toBe(expected)
    }
  )

  it('never carries the same mark twice on one run', () => {
    for (const src of ['_a*a*_\n', '_*a*a_\n', '__a**a**__\n']) {
      for (const marks of runMarks(src)) {
        expect(marks).toStrictEqual([...new Set(marks)])
      }
    }
  })

  // Nested marks must still nest, not merge: the inner mark spans a subset.
  it('keeps nesting when one run carries a superset of the marks', () => {
    const src = '*a **b** c*\n'
    expect(rt(src)).toBe(src)
    const marks = runMarks(rt(src))
    expect(marks.every((m) => m.includes('italic'))).toBe(true)
    expect(marks.some((m) => m.includes('bold'))).toBe(true)
  })
})
