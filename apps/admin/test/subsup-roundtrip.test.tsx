import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { tiptapToMarkdoc, markdocToTiptap } from '@setu/core'

function makeEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Subscript,
      Superscript,
    ],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    },
  })
}

describe('subscript/superscript roundtrip through markdoc', () => {
  it('toggleSubscript produces {% sub %} in markdoc output', () => {
    const editor = makeEditor()
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleSubscript().run()
    const markdoc = tiptapToMarkdoc(editor.getJSON())
    expect(markdoc).toContain('{% sub %}')
    editor.destroy()
  })

  it('markdocToTiptap round-trips subscript back to tiptap JSON with subscript mark', () => {
    const editor = makeEditor()
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleSubscript().run()
    const markdoc = tiptapToMarkdoc(editor.getJSON())
    const tiptapJson = markdocToTiptap(markdoc)
    const jsonStr = JSON.stringify(tiptapJson)
    expect(jsonStr).toContain('subscript')
    editor.destroy()
  })

  it('toggleSuperscript produces {% sup %} in markdoc output', () => {
    const editor = makeEditor()
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleSuperscript().run()
    const markdoc = tiptapToMarkdoc(editor.getJSON())
    expect(markdoc).toContain('{% sup %}')
    editor.destroy()
  })

  it('markdocToTiptap round-trips superscript back to tiptap JSON with superscript mark', () => {
    const editor = makeEditor()
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleSuperscript().run()
    const markdoc = tiptapToMarkdoc(editor.getJSON())
    const tiptapJson = markdocToTiptap(markdoc)
    const jsonStr = JSON.stringify(tiptapJson)
    expect(jsonStr).toContain('superscript')
    editor.destroy()
  })
})
