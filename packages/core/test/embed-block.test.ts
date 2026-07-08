import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

// The embed block is bodyless (self-closing) and must round-trip as a dedicated leaf
// `embedBlock` node — NOT the generic body-bearing setuBlock (which would inject an empty
// paragraph and re-emit a {% embed %}…{% /embed %} pair).

const KNOWN = { knownBlockTags: new Set(['embed']) }

describe('embed block round-trip', () => {
  it('maps {% embed /%} to a leaf embedBlock node (no body)', () => {
    const src =
      '{% embed url="https://youtu.be/abc" provider="youtube" mediaType="video" embedUrl="https://www.youtube.com/embed/abc" width=480 height=270 /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const block = doc.content.find((n) => n.type === 'embedBlock')
    expect(block).toBeDefined()
    expect(block!.content).toBeUndefined()
    expect(block!.attrs!.mdAttrs).toMatchObject({
      url: 'https://youtu.be/abc',
      provider: 'youtube',
      mediaType: 'video',
      embedUrl: 'https://www.youtube.com/embed/abc',
      width: 480,
      height: 270
    })
  })

  it('re-emits a self-closing {% embed … /%} with attributes preserved (no closing tag)', () => {
    const src =
      '{% embed url="https://vimeo.com/1" provider="vimeo" embedUrl="https://player.vimeo.com/video/1" /%}\n'
    const out = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    expect(out).toContain('{% embed')
    expect(out).toContain('provider="vimeo"')
    expect(out).toContain('/%}')
    expect(out).not.toContain('{% /embed %}')
  })

  it('is byte-stable across a second round-trip', () => {
    const src =
      '{% embed url="https://youtu.be/abc" provider="youtube" caption="A classic" /%}\n'
    const once = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    const twice = tiptapToMarkdoc(markdocToTiptap(once, KNOWN))
    expect(twice).toBe(once)
  })
})
