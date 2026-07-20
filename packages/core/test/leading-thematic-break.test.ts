import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))
const types = (s: string) => markdocToTiptap(s).content.map((n) => n.type)

/** #743 — a leading thematic break made Markdoc swallow the document.
 *
 *  `Markdoc.parse` strips a leading `---` … `---` span into
 *  `ast.attributes.frontmatter` with NO YAML-shape guard, and `markdocToTiptap`
 *  never looked at that attribute — so every block between the two fences was
 *  silently deleted. `parseMdoc` (src/markdoc/frontmatter.ts) has always drawn the
 *  line correctly (closed fence AND plain-object YAML); the two paths disagreed
 *  about what frontmatter is, and the reader's version destroyed content.
 *
 *  It needed TWO saves to show, which is why every single-pass property was blind
 *  to it: pass 1 normalised the author's `***` to `---`, and pass 2 — reading its
 *  own output — hit the strip.
 *
 *    "***\n\n# Heading\n\n- a\n\n***\n\ntail\n"
 *      pass 1 -> "---\n\n# Heading\n\n- a\n\n---\n\ntail\n"
 *      pass 2 -> "tail\n"                                  EVERYTHING deleted
 *
 *  Markdoc's rule is registered on the block ruler and only checks `startLine == 0`
 *  in whatever CONTAINER it is running in, so it fires inside a leading blockquote
 *  too — `"> ---\n> \n> ---\n"` was destroyed on the FIRST read, not the second. */
describe('#743 leading thematic break is content, not frontmatter', () => {
  it('reads a document whose first block is a `---` thematic break', () => {
    expect(types('---\n\n# Heading\n\n- a\n\n---\n\ntail\n')).toEqual([
      'horizontalRule',
      'heading',
      'bulletList',
      'horizontalRule',
      'paragraph'
    ])
  })

  it('survives the two-save composition that destroyed the document', () => {
    const source = '***\n\n# Heading\n\n- a\n\n***\n\ntail\n'
    const pass1 = roundtrip(source)
    const pass2 = roundtrip(pass1)
    expect(types(pass1)).toEqual(types(source))
    expect(pass2).toBe(pass1)
  })

  it('keeps a thematic break inside a leading blockquote', () => {
    const source = '> ---\n> \n> ---\n'
    expect(markdocToTiptap(source).content[0]?.content?.map((n) => n.type)) //
      .toEqual(['horizontalRule', 'horizontalRule'])
    expect(roundtrip(roundtrip(source))).toBe(roundtrip(source))
  })

  it('handles an empty `---`/`---` pair as two thematic breaks', () => {
    expect(types('---\n---\n')).toEqual(['horizontalRule', 'horizontalRule'])
  })

  // The other half of the guard: a REAL object-shaped fence is still frontmatter,
  // exactly as `parseMdoc` treats it — the fix must not start emitting a caller's
  // frontmatter as body content.
  it('still strips a genuine object-shaped frontmatter fence', () => {
    expect(types('---\ntitle: Hello\n---\n\nbody\n')).toEqual(['paragraph'])
  })
})
