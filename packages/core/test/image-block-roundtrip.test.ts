import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const KNOWN = { knownBlockTags: new Set(['image']) }
const rtKnown = (md: string) => tiptapToMarkdoc(markdocToTiptap(md, KNOWN))
const rtDefault = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

describe('{% image %} block — round-trip', () => {
  const full = `{% image src="/uploads/media/test/original.jpg" alt="A test cat" caption="A caption" align="wide" /%}\n`

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
      src: '/uploads/media/test/original.jpg', alt: 'A test cat', caption: 'A caption', align: 'wide',
    })
  })

  it('imageBlock round-trips byte-exact (self-closing, no body)', () => {
    expect(rtKnown(full)).toBe(full)
  })

  it('an imageBlock with only src serializes a minimal self-closing tag', () => {
    const minimal = `{% image src="/uploads/media/test/original.jpg" /%}\n`
    expect(rtKnown(minimal)).toBe(minimal)
  })
})
