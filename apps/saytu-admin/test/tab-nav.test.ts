import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { tabActionFor } from '../src/editor/extensions/KeyboardShortcuts'

let editor: Editor
afterEach(() => editor?.destroy())

const make = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })

describe('tabActionFor', () => {
  it('goes to the bubble for a non-empty selection', () => {
    editor = make()
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(tabActionFor(editor)).toBe('bubble')
  })
  it('consumes Tab at a plain empty caret (so focus does not escape the editor)', () => {
    editor = make()
    editor.commands.setTextSelection(3)
    expect(tabActionFor(editor)).toBe('consume')
  })
  it('indents (and always consumes) inside a list', () => {
    editor = make()
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBulletList().run()
    editor.commands.setTextSelection(3)
    expect(tabActionFor(editor)).toBe('indent')
  })
})
