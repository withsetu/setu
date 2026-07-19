import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const KNOWN = { knownBlockTags: new Set(['image']) }
const rtKnown = (md: string) => tiptapToMarkdoc(markdocToTiptap(md, KNOWN))
const rtDefault = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

describe('{% image %} block — round-trip', () => {
  const full = `{% image src="/media/2026/06/test-cat.jpg" alt="A test cat" caption="A caption" align="wide" /%}\n`

  // Default (no editor block registered): stays a verbatim passthrough (the #5a behavior).
  it('default knownBlockTags → passthrough, byte-exact', () => {
    expect(rtDefault(full)).toBe(full)
    const doc = markdocToTiptap(full)
    expect(doc.content?.[0]?.type).toBe('passthrough')
  })

  // With the editor block registered: becomes an imageBlock atom node, no forced body.
  it('image ∈ knownBlockTags → a single imageBlock atom node carrying mdAttrs', () => {
    const doc = markdocToTiptap(full, KNOWN)
    expect(doc.content).toHaveLength(1)
    expect(doc.content?.[0]?.type).toBe('imageBlock')
    expect(doc.content?.[0]?.content).toBeUndefined()
    expect(doc.content?.[0]?.attrs?.mdAttrs).toEqual({
      src: '/media/2026/06/test-cat.jpg',
      alt: 'A test cat',
      caption: 'A caption',
      align: 'wide'
    })
  })

  it('imageBlock round-trips byte-exact (self-closing, no body)', () => {
    expect(rtKnown(full)).toBe(full)
  })

  it('an imageBlock with only src serializes a minimal self-closing tag', () => {
    const minimal = `{% image src="/media/2026/06/test-cat.jpg" /%}\n`
    expect(rtKnown(minimal)).toBe(minimal)
  })

  it('caption containing a double-quote round-trips byte-exact (escape fix)', () => {
    // Markdoc parses \" → literal " in the attribute value; re-serializing must escape it back.
    const md = `{% image src="/media/2026/06/my-cat.jpg" caption="A \\"quoted\\" cat" /%}\n`
    // Single round-trip must be byte-exact.
    expect(rtKnown(md)).toBe(md)
    // Idempotency: second round-trip equals first.
    expect(rtKnown(rtKnown(md))).toBe(rtKnown(md))
  })

  it('unknown/extra attributes are preserved through the round-trip (no silent data loss)', () => {
    const md = `{% image src="/media/2026/06/my-cat.jpg" loading="lazy" /%}\n`
    expect(rtKnown(md)).toBe(md)
  })

  // #668: escapeAttrString only escaped \ and ", so a caption carrying a newline or a
  // tab produced a LITERAL newline inside the attribute — an unterminated attribute.
  // Re-reading that file yielded a flagged passthrough and the author saw an
  // "Unparsed Markdoc" blob where their image had been.
  describe('control characters in string attributes (#668)', () => {
    const imageDoc = (mdAttrs: Record<string, unknown>) => ({
      type: 'doc' as const,
      content: [{ type: 'imageBlock', attrs: { mdAttrs } }]
    })

    it('escapes a newline in a caption instead of breaking the tag', () => {
      const out = tiptapToMarkdoc(
        imageDoc({ src: '/a.png', caption: 'line one\nline two' })
      )
      expect(out).toBe(
        `{% image src="/a.png" caption="line one\\nline two" /%}\n`
      )
      // The written file must parse back to the same image, not a flagged passthrough.
      const reread = markdocToTiptap(out, KNOWN)
      expect(reread.content?.[0]?.type).toBe('imageBlock')
      expect(reread.content?.[0]?.attrs?.mdAttrs).toEqual({
        src: '/a.png',
        caption: 'line one\nline two'
      })
      expect(rtKnown(out)).toBe(out)
    })

    it('escapes a tab and a carriage return in a caption', () => {
      const out = tiptapToMarkdoc(
        imageDoc({ src: '/a.png', caption: 'a\tb\rc' })
      )
      expect(markdocToTiptap(out, KNOWN).content?.[0]?.type).toBe('imageBlock')
      expect(rtKnown(out)).toBe(out)
    })

    it('keeps src, alt, caption, align ordered first regardless of insertion order', () => {
      // Markdoc.format emits attributes in object insertion order, so the leadKeys
      // ordering has to be applied before formatting — it is not free.
      const out = tiptapToMarkdoc(
        imageDoc({
          loading: 'lazy',
          align: 'wide',
          caption: 'c',
          alt: 'a',
          src: '/a.png'
        })
      )
      expect(out).toBe(
        `{% image src="/a.png" alt="a" caption="c" align="wide" loading="lazy" /%}\n`
      )
    })
  })
})
