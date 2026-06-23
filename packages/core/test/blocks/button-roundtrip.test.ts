import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../../src/markdoc/to-markdoc'

const known = new Set(['button'])

describe('button round-trip', () => {
  it('maps {% button %} to a generic setuBlock node', () => {
    const doc = markdocToTiptap('{% button href="/signup" variant="primary" %}\nGet started\n{% /button %}', { knownBlockTags: known })
    const block = doc.content[0]!
    expect(block.type).toBe('setuBlock')
    expect(block.attrs).toEqual({ tag: 'button', mdAttrs: { href: '/signup', variant: 'primary' } })
  })
  it('round-trips {% button %} byte-stably', () => {
    const src = '{% button href="/signup" variant="primary" %}\nGet started\n{% /button %}'
    expect(tiptapToMarkdoc(markdocToTiptap(src, { knownBlockTags: known })).trim()).toBe(src)
  })
})
