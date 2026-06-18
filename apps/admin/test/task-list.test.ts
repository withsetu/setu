import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'

let editor: Editor
afterEach(() => editor?.destroy())

describe('task list extension', () => {
  it('toggles a task list', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false }), TaskList, TaskItem.configure({ nested: true })],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
    })
    editor.chain().focus().toggleTaskList().run()
    expect(editor.isActive('taskList')).toBe(true)
  })
})
