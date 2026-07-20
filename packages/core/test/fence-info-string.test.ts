import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc } from '../src/index'

const rt = (s: string) => tiptapToMarkdoc(markdocToTiptap(s))

const codeDoc = (language: string, text: string): TiptapDoc => ({
  type: 'doc',
  content: [
    {
      type: 'codeBlock',
      attrs: { language },
      content: text === '' ? [] : [{ type: 'text', text }]
    }
  ]
})

/** #726. A fence INFO STRING (the bit after the opening fence, which the editor
 *  surfaces as the code block's language) was handed to `Markdoc.format`
 *  unescaped. Markdoc only ever emits BACKTICK fences, and CommonMark forbids a
 *  backtick in a backtick fence's info string for exactly this reason: the
 *  backtick closes the fence early, so everything after it was re-parsed as new
 *  content and the document GREW on every save.
 *
 *  CommonMark gives an info string no escape mechanism at all, so the faithful
 *  repair is the other fence spelling: a TILDE fence may carry backticks in its
 *  info string. Nothing is dropped and nothing is invented. */
describe('#726 a backtick in a fence info string does not break the fence', () => {
  it('does not grow the document', () => {
    const once = rt('~~~`\n')
    expect(rt(once)).toBe(once)
    expect(rt(once).length).toBeLessThanOrEqual(once.length)
  })

  it('preserves the info string instead of splitting the fence', () => {
    const once = rt('~~~`\n')
    const doc = markdocToTiptap(once)
    expect(doc.content.map((n) => n.type)).toEqual(['codeBlock'])
    expect(doc.content[0]?.attrs?.['language']).toBe('`')
  })

  it('preserves body content under a backtick info string', () => {
    const src = tiptapToMarkdoc(codeDoc('a`b', 'x\ny'))
    const doc = markdocToTiptap(src)
    expect(doc.content[0]?.attrs?.['language']).toBe('a`b')
    expect(doc.content[0]?.content?.[0]?.text).toBe('x\ny')
    expect(rt(src)).toBe(src)
  })

  it('widens the tilde fence past a tilde run in the body', () => {
    const src = tiptapToMarkdoc(codeDoc('`', '~~~\nstill inside\n~~~~'))
    const doc = markdocToTiptap(src)
    expect(doc.content.map((n) => n.type)).toEqual(['codeBlock'])
    expect(doc.content[0]?.content?.[0]?.text).toBe('~~~\nstill inside\n~~~~')
    expect(rt(src)).toBe(src)
  })

  /** The control: an ordinary language keeps the canonical backtick fence, so no
   *  existing code block is rewritten. */
  it('leaves an ordinary fence byte-identical', () => {
    expect(rt('```ts\nconst a = 1\n```\n')).toBe('```ts\nconst a = 1\n```\n')
    expect(rt('```\nplain\n```\n')).toBe('```\nplain\n```\n')
  })
})
