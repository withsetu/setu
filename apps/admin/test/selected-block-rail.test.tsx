import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'
import { selectedBlockOf } from '../src/editor/useSelectedBlock'

function makeEditor() {
  // A leading paragraph gives the initial cursor a text node to land in, so the
  // default selection is a TextSelection (not a NodeSelection on heroBlock).
  return new Editor({ extensions: [StarterKit, HeroBlock],
    content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'heroBlock', attrs: { mdAttrs: { headline: 'Hi', variant: 'center' } } }] } })
}

describe('selectedBlockOf', () => {
  it('returns null when no block is selected', () => {
    const e = makeEditor()
    expect(selectedBlockOf(e.state)).toBeNull()
    e.destroy()
  })
  it('returns the hero tag + mdAttrs when the heroBlock node is selected', () => {
    const e = makeEditor()
    // heroBlock is the second top-level child; its start pos = 1 (para open) + 1 (para close) = 2
    const heroPos = e.state.doc.resolve(2).before(1) // pos before the heroBlock node
    // Use NodeSelection.create with the node's position (the para is at pos 0-2, heroBlock at pos 2)
    const nodePos = 2 // after the empty paragraph (open=1, close=2)
    const tr = e.state.tr.setSelection(NodeSelection.create(e.state.doc, nodePos))
    e.view.dispatch(tr)
    const sel = selectedBlockOf(e.state)
    expect(sel).toMatchObject({ tag: 'hero', mdAttrs: { headline: 'Hi' } })
    e.destroy()
  })
})
