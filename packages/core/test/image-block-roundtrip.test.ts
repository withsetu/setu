import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const rt = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

// #5a registers {% image %} for RENDER only; the editor has no block for it, so it must pass
// through verbatim. Guards against a regression that would force a body onto the bodyless tag.
describe('{% image %} block — #5a passthrough safety', () => {
  const md = `{% image src="/uploads/media/test/original.png" alt="A test cat" caption="A caption" align="wide" /%}\n`

  it('round-trips a bodyless {% image %} tag byte-exact', () => {
    expect(rt(md)).toBe(md)
  })

  it('represents an unknown {% image %} tag as a single passthrough node (no forced body)', () => {
    const doc = markdocToTiptap(md)
    expect(doc.content).toHaveLength(1)
    expect(doc.content?.[0]?.type).toBe('passthrough')
    expect(doc.content?.[0]?.content).toBeUndefined()
  })
})
