import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BLOCK_TYPES, currentBlockType } from '../src/editor/block-types'
import { isIconName } from '../src/ui/Icon'

const make = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
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
      'paragraph', 'h2', 'h3', 'h4', 'bulletList', 'orderedList', 'blockquote', 'codeBlock',
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
    e.chain().setTextSelection({ from: 1, to: 6 }).setNode('heading', { level: 3 }).run()
    expect(currentBlockType(e).id).toBe('h3')
    e.chain().setNode('paragraph').toggleBulletList().run()
    expect(currentBlockType(e).id).toBe('bulletList')
    e.destroy()
  })
})
