import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '../src/index'

describe('markdocToTiptap', () => {
  it('converts a heading', () => {
    const doc = markdocToTiptap('# Hello\n')
    expect(doc).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] },
      ],
    })
  })

  it('converts bold + italic + code marks', () => {
    const doc = markdocToTiptap('A **b** *i* `c`\n')
    const para = doc.content[0]!
    expect(para.type).toBe('paragraph')
    expect(para.content).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'code' }] },
    ])
  })

  it('maps a known block tag (callout) to a callout node', () => {
    const doc = markdocToTiptap('{% callout type="warning" %}\nHi\n{% /callout %}\n')
    const node = doc.content[0]!
    expect(node.type).toBe('callout')
    expect((node.attrs as any).mdAttrs).toMatchObject({ type: 'warning' })
  })

  it('recognizes callout by default, sourced from the config (not a hardcoded constant)', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n')
    expect(doc.content[0]!.type).toBe('callout')
  })

  it('treats callout as passthrough when an empty knownBlockTags set is supplied', () => {
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n', {
      knownBlockTags: new Set<string>(),
    })
    expect(doc.content[0]!.type).toBe('passthrough')
  })

  it('preserves an unknown/advanced tag ({% if %}) as a passthrough node', () => {
    const doc = markdocToTiptap('{% if $x %}\nHi\n{% /if %}\n')
    const node = doc.content[0]!
    expect(node.type).toBe('passthrough')
    expect((node.attrs as any).flagged).toBe(false)
    expect((node.attrs as any).raw).toContain('{% if $x %}')
    expect((node.attrs as any).raw).toContain('{% /if %}')
  })

  it('preserves malformed Markdoc as a flagged passthrough (never dropped)', () => {
    const src = 'Intro.\n\n{% for $p in $ps %}\n- {% $p.name %}\n{% /for %}\n\nOutro.\n'
    const doc = markdocToTiptap(src)
    const flagged = doc.content.find((n) => n.type === 'passthrough')!
    expect(flagged).toBeDefined()
    expect((flagged.attrs as any).flagged).toBe(true)
    expect((flagged.attrs as any).raw).toContain('{% for $p in $ps %}')
  })
})

describe('subscript/superscript inline tags', () => {
  it('maps {% sub %}/{% sup %} to subscript/superscript marks', () => {
    const doc = markdocToTiptap('H{% sub %}2{% /sub %}O e=mc{% sup %}2{% /sup %}\n')
    const json = JSON.stringify(doc)
    expect(json).toContain('"subscript"')
    expect(json).toContain('"superscript"')
  })
})

describe('task lists + nesting (markdocToTiptap)', () => {
  it('maps an all-marker unordered list to a taskList with checked flags', () => {
    const doc = markdocToTiptap('- [ ] todo\n- [x] done\n')
    expect(doc.content[0]).toEqual({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }] },
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] },
      ],
    })
  })

  it('reads uppercase [X] as checked', () => {
    const doc = markdocToTiptap('- [X] done\n')
    const item = doc.content[0]!.content![0]!
    expect(item).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
  })

  it('strips the marker but keeps inner marks', () => {
    const doc = markdocToTiptap('- [ ] do the **thing**\n')
    const para = doc.content[0]!.content![0]!.content![0]!
    expect(para.content).toEqual([
      { type: 'text', text: 'do the ' },
      { type: 'text', text: 'thing', marks: [{ type: 'bold' }] },
    ])
  })

  it('keeps a plain bullet list as a bulletList (no false checklist)', () => {
    const doc = markdocToTiptap('- a\n- b\n')
    expect(doc.content[0]!.type).toBe('bulletList')
  })

  it('keeps a partial-marker list as a bulletList with literal marker text preserved', () => {
    const doc = markdocToTiptap('- [ ] a\n- b\n')
    expect(doc.content[0]!.type).toBe('bulletList')
    const firstItemPara = doc.content[0]!.content![0]!.content![0]!
    expect(firstItemPara.content).toEqual([{ type: 'text', text: '[ ] a' }])
  })

  it('preserves a nested bullet list inside a list item', () => {
    const doc = markdocToTiptap('- a\n  - b\n')
    expect(doc.content[0]).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
          ],
        },
      ],
    })
  })

  it('preserves a nested checklist under a bullet (mixed)', () => {
    const doc = markdocToTiptap('- parent\n  - [x] sub\n')
    const outer = doc.content[0]!
    expect(outer.type).toBe('bulletList')
    const nested = outer.content![0]!.content![1]!
    expect(nested).toMatchObject({ type: 'taskList' })
    expect(nested.content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
  })

  it('drops an empty marker text node (- [ ] with no text)', () => {
    const doc = markdocToTiptap('- [ ]\n')
    expect(doc.content[0]!.type).toBe('bulletList')
  })
})
