import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BLOCK_TYPES, currentBlockType } from '../src/editor/block-types'
import { isIconName } from '../src/ui/Icon'

const make = () =>
  new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false })
    ],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
      ]
    }
  })

describe('BLOCK_TYPES registry', () => {
  it('has unique ids, non-empty labels, and known icons', () => {
    const ids = new Set<string>()
    for (const b of BLOCK_TYPES) {
      expect(b.label.length).toBeGreaterThan(0)
      expect(isIconName(b.icon)).toBe(true)
      expect(ids.has(b.id)).toBe(false)
      ids.add(b.id)
    }
  })
  it('offers H2/H3/H4 (not H1) and the expected block ids', () => {
    expect(BLOCK_TYPES.map((b) => b.id)).toEqual([
      'paragraph',
      'h2',
      'h3',
      'h4',
      'bulletList',
      'orderedList',
      'blockquote',
      'codeBlock',
      'taskList'
    ])
  })
})

describe('currentBlockType', () => {
  it('is Text for a plain paragraph', () => {
    const e = make()
    expect(currentBlockType(e).id).toBe('paragraph')
    e.destroy()
  })
  it('reflects an applied heading and list', () => {
    const e = make()
    e.chain()
      .setTextSelection({ from: 1, to: 6 })
      .setNode('heading', { level: 3 })
      .run()
    expect(currentBlockType(e).id).toBe('h3')
    e.chain().setNode('paragraph').toggleBulletList().run()
    expect(currentBlockType(e).id).toBe('bulletList')
    e.destroy()
  })
})

describe('BLOCK_TYPES shortcuts', () => {
  it('carries the documented StarterKit keys', () => {
    const keyOf = (id: string) => BLOCK_TYPES.find((b) => b.id === id)?.keys
    expect(keyOf('paragraph')).toEqual(['Mod', 'Alt', '0'])
    expect(keyOf('h2')).toEqual(['Mod', 'Alt', '2'])
    expect(keyOf('h3')).toEqual(['Mod', 'Alt', '3'])
    expect(keyOf('h4')).toEqual(['Mod', 'Alt', '4'])
    expect(keyOf('bulletList')).toEqual(['Mod', 'Shift', '8'])
    expect(keyOf('orderedList')).toEqual(['Mod', 'Shift', '7'])
    expect(keyOf('blockquote')).toEqual(['Mod', 'Shift', 'b'])
    expect(keyOf('codeBlock')).toEqual(['Mod', 'Alt', 'c'])
  })
})
