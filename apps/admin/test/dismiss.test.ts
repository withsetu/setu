import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { isEscape, collapseSelectionOnEscape } from '../src/editor/dismiss'

describe('isEscape', () => {
  it('is true only for the Escape key', () => {
    expect(isEscape({ key: 'Escape' } as KeyboardEvent)).toBe(true)
    expect(isEscape({ key: 'Esc' } as KeyboardEvent)).toBe(false)
    expect(isEscape({ key: 'a' } as KeyboardEvent)).toBe(false)
  })
})

describe('collapseSelectionOnEscape', () => {
  let editor: Editor
  afterEach(() => editor?.destroy())

  const make = () =>
    new Editor({
      extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
    })

  it('collapses a non-empty selection and reports handled', () => {
    editor = make()
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(editor.state.selection.empty).toBe(false)
    expect(collapseSelectionOnEscape(editor)).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
  })

  it('does nothing (returns false) when the selection is already empty', () => {
    editor = make()
    editor.commands.setTextSelection(3)
    expect(collapseSelectionOnEscape(editor)).toBe(false)
    expect(editor.state.selection.empty).toBe(true)
  })
})
