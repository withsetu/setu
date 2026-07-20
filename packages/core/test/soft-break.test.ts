import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapNode } from '../src/index'

const rt = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

/** #667. A SOFT line break — the plain newline inside a paragraph that a
 *  hard-wrapped file is made of — was converted to a single space and had no
 *  inverse on the way out, so every hard-wrapped paragraph was reflowed onto one
 *  line the first time its entry was saved.
 *
 *  Rendered HTML is identical either way, so nothing looked broken. For a
 *  Git-backed CMS that is precisely the problem: one save produces a WHOLE-FILE
 *  diff on every hard-wrapped `.mdoc`, which buries the real change in review and
 *  makes `git blame` useless.
 *
 *  A soft break is modelled as a `\n` inside a text node rather than as a new
 *  schema node. It needs no editor extension (a bare `text` node is already legal
 *  everywhere inline content is), it collapses to a space in the editor canvas
 *  exactly as it does in rendered HTML, and — unlike a dedicated node — it carries
 *  the enclosing marks, so `*a\nb*` stays ONE emphasis run instead of being split
 *  into two delimiter pairs (the #693 corruption class). */
describe('#667 soft line breaks survive a round-trip', () => {
  it('keeps a hard-wrapped paragraph byte-identical', () => {
    const src =
      'The quick brown fox jumps and\nthen keeps running\nfinally stops.\n'
    expect(rt(src)).toBe(src)
    expect(rt(rt(src))).toBe(src)
  })

  it('keeps a two-line definition-style paragraph byte-identical', () => {
    expect(rt('term\n: def\n')).toBe('term\n: def\n')
  })

  it('reads a soft break as a newline, not a space', () => {
    const para = markdocToTiptap('a\nb\n').content[0] as TiptapNode
    expect((para.content ?? []).map((c) => c.text).join('')).toBe('a\nb')
  })

  it('keeps a hard break distinct from a soft break', () => {
    // Two trailing spaces are a HARD break: it must still be a hardBreak node and
    // must not be flattened into the soft-break newline.
    const para = markdocToTiptap('a  \nb\n').content[0] as TiptapNode
    expect((para.content ?? []).map((c) => c.type)).toContain('hardBreak')
  })

  it('keeps a soft break inside one emphasis run', () => {
    expect(rt('*a\nb*\n')).toBe('*a\nb*\n')
  })

  it('keeps a soft break inside a list item, indented as a continuation', () => {
    // `- a\n  b` and the lazy `- a\nb` are the same document; the indented form is
    // the canonical one and is a fixed point.
    const out = rt('- a\n  b\n- c\n')
    expect(out).toBe('- a\n  b\n- c\n')
    expect(rt(out)).toBe(out)
  })

  it('keeps a soft break inside a blockquote and a tag body', () => {
    expect(rt('> a\n> b\n')).toBe('> a\n> b\n')
    expect(rt('{% callout %}\na\nb\n{% /callout %}\n')).toBe(
      '{% callout %}\na\nb\n{% /callout %}\n'
    )
  })

  /** A continuation line is escaped as a block start even when the marker could not
   *  have interrupted the paragraph in the SOURCE. That is deliberate, and it is the
   *  lesson the property suite taught at ~23k runs: the source's protection can be
   *  indentation ("a\n\t#"), which the reader strips, so re-emitting verbatim puts a
   *  live `#` at column 0 and splits the block. Escaping is idempotent, so the cost
   *  of an unnecessary backslash is one stable byte; the cost of a missing one is a
   *  destroyed paragraph. */
  it('escapes a block marker on a continuation line, and stays stable', () => {
    expect(rt('a\n2. b\n')).toBe('a\n2\\. b\n')
    expect(rt('a\n2\\. b\n')).toBe('a\n2\\. b\n')
  })

  it('keeps an indented marker inert instead of promoting it to a heading', () => {
    // The counterexample itself: the tab makes `#` inert in the source, and the
    // reader drops the tab. Without the escape this re-read as paragraph + heading.
    const out = rt('a\n\t#\n')
    expect(markdocToTiptap(out).content.map((n) => n.type)).toEqual([
      'paragraph'
    ])
    expect(rt(out)).toBe(out)
  })

  /** CRLF decision (#667): line endings are normalised to LF, deliberately.
   *  Markdoc/markdown-it normalise CR and CRLF away BEFORE tokenizing, so the
   *  reader never sees a CR at all; preserving per-file style would mean carrying
   *  a file-level attribute the pure `string -> TiptapDoc -> string` round-trip has
   *  nowhere to put. Line-ending policy belongs to Git (`core.autocrlf` /
   *  `.gitattributes`), not to the CMS serializer. The cost is bounded: a
   *  CRLF-authored file is rewritten ONCE, on its first save, and is byte-stable
   *  from then on — as against #667's whole-file diff on EVERY save. */
  it('normalises CRLF to LF once and is stable thereafter', () => {
    const out = rt('a\r\nb\r\n\r\nc\r\n')
    expect(out).toBe('a\nb\n\nc\n')
    expect(rt(out)).toBe(out)
  })
})
