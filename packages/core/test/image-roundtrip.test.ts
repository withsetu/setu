import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const rt = (md: string) => tiptapToMarkdoc(markdocToTiptap(md))

describe('image round-trip', () => {
  it('round-trips a lone-paragraph image (the editor figure case)', () => {
    const md = `![A cat](/uploads/media/abc/original.png)\n`
    expect(rt(md)).toBe(md)
  })

  it('maps a Markdoc image to an inline image node with path src + alt', () => {
    const doc = markdocToTiptap(`![A cat](/uploads/media/abc/original.png)\n`)
    const para = doc.content?.[0]
    expect(para?.type).toBe('paragraph')
    expect(para?.content?.[0]).toEqual({
      type: 'image',
      attrs: { src: '/uploads/media/abc/original.png', alt: 'A cat', title: null },
    })
  })

  it('preserves an image mixed inline with text (content-safety — never drop)', () => {
    const md = `hello ![x](/uploads/media/abc/original.png) world\n`
    expect(rt(md)).toBe(md)
  })

  it('preserves a title', () => {
    const md = `![A cat](/uploads/media/abc/original.png "the title")\n`
    expect(rt(md)).toBe(md)
  })

  it('round-trips an absolute external src untouched', () => {
    const md = `![ext](https://example.com/photo.png)\n`
    expect(rt(md)).toBe(md)
  })
})
