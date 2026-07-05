import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  isBubblePopupOpen,
  registerBubblePopup,
  bubbleEscapeShouldCollapse
} from '../src/editor/bubble-popup'

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

describe('bubble-popup guard', () => {
  it('tracks open count and releases idempotently', () => {
    expect(isBubblePopupOpen()).toBe(false)
    const a = registerBubblePopup()
    expect(isBubblePopupOpen()).toBe(true)
    const b = registerBubblePopup()
    a()
    expect(isBubblePopupOpen()).toBe(true) // b still open
    a()
    expect(isBubblePopupOpen()).toBe(true) // double-release of a is a no-op
    b()
    expect(isBubblePopupOpen()).toBe(false)
  })

  it('suppresses the bubble Esc-collapse while a popup is open', () => {
    const e = make()
    e.commands.setTextSelection({ from: 1, to: 6 })
    expect(bubbleEscapeShouldCollapse(e)).toBe(true) // closed: bubble Esc would collapse
    const release = registerBubblePopup()
    expect(bubbleEscapeShouldCollapse(e)).toBe(false) // popup owns Esc
    release()
    expect(bubbleEscapeShouldCollapse(e)).toBe(true)
    e.commands.setTextSelection(3) // collapse to caret
    expect(bubbleEscapeShouldCollapse(e)).toBe(false) // nothing to collapse
    e.destroy()
  })
})
