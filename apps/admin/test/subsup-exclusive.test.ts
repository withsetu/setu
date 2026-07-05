import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'

// Mirrors the Canvas.tsx registration: sub/sup exclude each other.
const exts = () => [
  StarterKit.configure({ link: { openOnClick: false }, underline: false }),
  Subscript.extend({ excludes: 'superscript' }),
  Superscript.extend({ excludes: 'subscript' })
]

let e: Editor
afterEach(() => e?.destroy())

const make = () =>
  new Editor({
    extensions: exts(),
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
      ]
    }
  })

describe('subscript/superscript are mutually exclusive', () => {
  it('applying superscript clears subscript', () => {
    e = make()
    e.chain()
      .setTextSelection({ from: 1, to: 6 })
      .toggleSubscript()
      .toggleSuperscript()
      .run()
    expect(e.isActive('superscript')).toBe(true)
    expect(e.isActive('subscript')).toBe(false)
  })
  it('applying subscript clears superscript', () => {
    e = make()
    e.chain()
      .setTextSelection({ from: 1, to: 6 })
      .toggleSuperscript()
      .toggleSubscript()
      .run()
    expect(e.isActive('subscript')).toBe(true)
    expect(e.isActive('superscript')).toBe(false)
  })
})
