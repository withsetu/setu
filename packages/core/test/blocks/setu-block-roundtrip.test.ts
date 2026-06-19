import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../../src/markdoc/to-markdoc'

const known = new Set(['callout', 'notice'])

describe('setuBlock round-trip', () => {
  it('maps a known non-callout tag to a generic setuBlock node', () => {
    const doc = markdocToTiptap('{% notice tone="warn" %}\nHi there.\n{% /notice %}', { knownBlockTags: known })
    const block = doc.content[0]!
    expect(block.type).toBe('setuBlock')
    expect(block.attrs).toEqual({ tag: 'notice', mdAttrs: { tone: 'warn' } })
    expect(block.content?.[0]?.type).toBe('paragraph')
  })
  it('serializes a setuBlock back to its own tag (byte-stable)', () => {
    const src = '{% notice tone="warn" %}\nHi there.\n{% /notice %}'
    expect(tiptapToMarkdoc(markdocToTiptap(src, { knownBlockTags: known })).trim()).toBe(src)
  })
  it('still maps callout to the callout node (frozen)', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi.\n{% /callout %}', { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('callout')
  })
  it('throws (never serializes {% undefined %}) when a setuBlock has no tag', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'setuBlock', attrs: { mdAttrs: {} }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }
    expect(() => tiptapToMarkdoc(doc)).toThrow(/missing its "tag"/)
  })
})
