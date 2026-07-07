import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { TiptapDoc } from '@setu/core'
import { markdocToTiptap, tiptapToMarkdoc } from '@setu/core'
import { Callout } from '../src/editor/extensions/Callout'
import { Passthrough } from '../src/editor/extensions/Passthrough'

const SOURCE =
  '# Title\n\n' +
  'A **bold** and *italic* line with `code` and a [link](https://x.com).\n\n' +
  '- one\n- two\n\n' +
  '{% callout type="warning" %}\nHeads up.\n{% /callout %}\n\n' +
  '{% if $x %}\nsecret\n{% /if %}\n\n' +
  'Done.\n'

describe('editor schema round-trips through the Markdoc converter', () => {
  it('preserves every node + callout mdAttrs + passthrough raw/flagged via getJSON', () => {
    const editor = new Editor({
      extensions: [StarterKit, Callout, Passthrough],
      content: markdocToTiptap(SOURCE, { knownBlockTags: new Set(['callout']) })
    })
    const json = editor.getJSON() as TiptapDoc

    const callout = json.content.find((n) => n.type === 'callout')
    expect(callout?.attrs?.mdAttrs).toEqual({ type: 'warning' })

    const pass = json.content.find((n) => n.type === 'passthrough')
    expect(pass?.attrs).toEqual({
      raw: '{% if $x %}\nsecret\n{% /if %}',
      flagged: false
    })

    // The full round-trip back to Markdoc reproduces the source byte-for-byte.
    expect(tiptapToMarkdoc(json)).toBe(SOURCE)
    editor.destroy()
  })

  it('preserves a titled/typed/iconned callout through getJSON + round-trips', () => {
    const SRC =
      '{% callout type="success" title="Success & Prosperity" icon="check" %}\n' +
      'Body text.\n' +
      '{% /callout %}\n\n' +
      'After.\n'
    const editor = new Editor({
      extensions: [StarterKit, Callout, Passthrough],
      content: markdocToTiptap(SRC, { knownBlockTags: new Set(['callout']) })
    })
    const json = editor.getJSON() as TiptapDoc
    const callout = json.content.find((n) => n.type === 'callout')
    expect(callout?.attrs?.mdAttrs).toEqual({
      type: 'success',
      title: 'Success & Prosperity',
      icon: 'check'
    })
    expect(tiptapToMarkdoc(json)).toBe(SRC)
    editor.destroy()
  })

  it('a plain callout (no attrs) still round-trips', () => {
    const SRC = '{% callout %}\nJust body.\n{% /callout %}\n\nAfter.\n'
    const editor = new Editor({
      extensions: [StarterKit, Callout, Passthrough],
      content: markdocToTiptap(SRC, { knownBlockTags: new Set(['callout']) })
    })
    expect(tiptapToMarkdoc(editor.getJSON() as TiptapDoc)).toBe(SRC)
    editor.destroy()
  })
})
