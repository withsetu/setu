import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TURN_INTO_GROUPS, groupContaining, BLOCK_TYPES } from '../src/editor/block-types'

const make = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })

const ids = new Set(BLOCK_TYPES.map((b) => b.id))

describe('TURN_INTO_GROUPS', () => {
  it('is Text(leaf), Heading(group h2/h3/h4), List(group bullet/ordered), Quote(leaf), Code(leaf)', () => {
    const shape = TURN_INTO_GROUPS.map((e) => (e.kind === 'leaf' ? `leaf:${e.type.id}` : `group:${e.id}[${e.items.map((i) => i.id).join(',')}]`))
    expect(shape).toEqual([
      'leaf:paragraph',
      'group:heading[h2,h3,h4]',
      'group:list[bulletList,orderedList]',
      'leaf:blockquote',
      'leaf:codeBlock',
    ])
  })
  it('every referenced block type is a real BLOCK_TYPES entry', () => {
    for (const e of TURN_INTO_GROUPS) {
      if (e.kind === 'leaf') expect(ids.has(e.type.id)).toBe(true)
      else for (const it of e.items) expect(ids.has(it.id)).toBe(true)
    }
  })
})

describe('groupContaining', () => {
  it('returns the active group id, or null for a leaf/plain block', () => {
    const e = make()
    expect(groupContaining(e)).toBe(null)
    e.chain().setTextSelection({ from: 1, to: 6 }).setNode('heading', { level: 3 }).run()
    expect(groupContaining(e)).toBe('heading')
    e.chain().setNode('paragraph').toggleBulletList().run()
    expect(groupContaining(e)).toBe('list')
    e.destroy()
  })
})
