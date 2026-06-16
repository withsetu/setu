import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Callout } from '../src/editor/extensions/Callout'
import { Passthrough } from '../src/editor/extensions/Passthrough'
import { slashBlocks } from '../src/editor/blocks'

describe('slashBlocks', () => {
  it('includes the built-ins and the config Callout block', () => {
    const titles = slashBlocks().map((b) => b.title)
    expect(titles).toContain('Heading 2')
    expect(titles).toContain('Callout')
  })

  it('the Callout block inserts a callout node', () => {
    const editor = new Editor({
      extensions: [StarterKit, Callout, Passthrough],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const callout = slashBlocks().find((b) => b.title === 'Callout')
    expect(callout).toBeDefined()
    callout!.run(editor, { from: 1, to: 1 })
    expect(editor.getJSON().content?.some((n) => n.type === 'callout')).toBe(true)
    editor.destroy()
  })
})
