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
