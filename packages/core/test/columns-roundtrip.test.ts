import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc } from '../src/index'

// Round-trip coverage for the columns block (#181) — the first multi-slot nested
// container (Shape B). `{% columns %}` maps to a bespoke `columns` Tiptap node whose
// children are `column` nodes; anything structurally invalid (wrong child types,
// out-of-range column count) falls back to the generic setuBlock chrome so no
// hand-authored content is ever silently dropped or rewritten.

const known = new Set(['columns', 'column', 'callout', 'image', 'hero'])
const rt = (s: string) =>
  tiptapToMarkdoc(markdocToTiptap(s, { knownBlockTags: known }))

describe('columns round-trip (#181)', () => {
  it('maps a well-formed columns tag to bespoke columns/column nodes', () => {
    const src = `{% columns layout="50-50" %}
{% column %}
Left **bold**.
{% /column %}

{% column %}
Right.
{% /column %}
{% /columns %}
`
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    const columns = doc.content[0]!
    expect(columns.type).toBe('columns')
    expect(columns.attrs?.mdAttrs).toEqual({ layout: '50-50' })
    expect(columns.content?.map((c) => c.type)).toEqual(['column', 'column'])
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })

  it('round-trips 3 and 4 column layouts with gap and stackOnMobile', () => {
    const src = `{% columns layout="33-33-33" gap="lg" stackOnMobile=false %}
{% column %}
One
{% /column %}

{% column %}
Two
{% /column %}

{% column %}
Three
{% /column %}
{% /columns %}
`
    expect(rt(src)).toBe(src)
  })

  it('round-trips a callout inside a column and an image inside a column', () => {
    const src = `{% columns layout="33-67" %}
{% column %}
{% callout type="info" %}
Note inside a column.
{% /callout %}
{% /column %}

{% column %}
{% image src="/media/x.png" alt="pic" /%}
{% /column %}
{% /columns %}
`
    expect(rt(src)).toBe(src)
  })

  it('round-trips columns nested inside a callout body', () => {
    const src = `{% callout type="warning" %}
{% columns layout="50-50" %}
{% column %}
A
{% /column %}

{% column %}
B
{% /column %}
{% /columns %}
{% /callout %}
`
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('callout')
    expect(doc.content[0]!.content?.[0]?.type).toBe('columns')
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })

  it('round-trips a GFM table inside a column', () => {
    const src = `{% columns layout="50-50" %}
{% column %}
| A | B |
| --- | --- |
| 1 | 2 |
{% /column %}

{% column %}
x
{% /column %}
{% /columns %}
`
    expect(rt(src)).toBe(src)
  })

  it('an empty column round-trips and seeds an editable paragraph', () => {
    const src = `{% columns layout="50-50" %}
{% column %}
Text.
{% /column %}

{% column %}

{% /column %}
{% /columns %}
`
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    const second = doc.content[0]!.content![1]!
    // Schema requires block+ inside a column — an empty body seeds one paragraph.
    expect(second.content?.[0]?.type).toBe('paragraph')
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })

  it('falls back to generic setuBlock when children are not all columns', () => {
    const src = `{% columns layout="50-50" %}
Stray paragraph directly inside columns.
{% /columns %}
`
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('setuBlock')
    expect(doc.content[0]!.attrs?.tag).toBe('columns')
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })

  it('falls back to generic setuBlock on an out-of-range column count', () => {
    const one = `{% columns layout="50-50" %}
{% column %}
Only one.
{% /column %}
{% /columns %}
`
    const doc = markdocToTiptap(one, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('setuBlock')
    expect(tiptapToMarkdoc(doc)).toBe(one)
  })

  it('a bare column tag outside columns stays generic and round-trips', () => {
    const src = `{% column %}
Loose column.
{% /column %}
`
    const doc = markdocToTiptap(src, { knownBlockTags: known })
    expect(doc.content[0]!.type).toBe('setuBlock')
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })

  it('serializes an editor-inserted columns node (never parsed from source)', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'columns',
          attrs: { mdAttrs: { layout: '50-50' } },
          content: [
            {
              type: 'column',
              attrs: { mdAttrs: {} },
              content: [{ type: 'paragraph', content: [] }]
            },
            {
              type: 'column',
              attrs: { mdAttrs: {} },
              content: [{ type: 'paragraph', content: [] }]
            }
          ]
        }
      ]
    }
    const out = tiptapToMarkdoc(doc)
    expect(out).toBe(`{% columns layout="50-50" %}
{% column %}

{% /column %}

{% column %}

{% /column %}
{% /columns %}
`)
    // And the emitted source is a fixed point.
    expect(rt(out)).toBe(out)
  })
})

describe('nested string-serialized blocks inside tag bodies (latent bug fix)', () => {
  it('no longer drops an image block inside a callout body', () => {
    const src = `{% callout type="info" %}
Text.

{% image src="/media/x.png" alt="pic" /%}
{% /callout %}
`
    expect(rt(src)).toBe(src)
  })

  it('no longer drops a GFM table inside a callout body', () => {
    const src = `{% callout type="info" %}
| A | B |
| --- | --- |
| 1 | 2 |
{% /callout %}
`
    expect(rt(src)).toBe(src)
  })
})
