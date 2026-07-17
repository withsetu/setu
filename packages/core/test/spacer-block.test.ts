import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import { resolveControls } from '../src/blocks/resolve-controls'

// markdocToTiptap accepts a raw Markdoc string (parses internally);
// tiptapToMarkdoc accepts a TiptapDoc and returns a Markdoc string.

const KNOWN = { knownBlockTags: new Set(['spacer']) }

describe('spacer block (#183)', () => {
  it('is registered as a standard block in the layout group with slash keywords', () => {
    const spacer = STANDARD_BLOCKS.find((b) => b.tag === 'spacer')
    expect(spacer).toBeDefined()
    expect(spacer!.renderer).toBe('@setu/blocks/spacer.astro')
    expect(spacer!.contract.editor?.group).toBe('layout')
    expect(spacer!.contract.editor?.keywords).toContain('gap')
    expect(spacer!.contract.editor?.keywords).toContain('space')
  })

  it('height resolves to a slider control carrying the zod range (8–200, default 48)', () => {
    const spacer = STANDARD_BLOCKS.find((b) => b.tag === 'spacer')!
    const out = resolveControls(
      spacer.contract.props,
      spacer.contract.editor!.controls
    )
    const height = out.find((c) => c.name === 'height')
    expect(height).toBeDefined()
    expect(height!.control).toBe('slider')
    expect(height!.default).toBe(48)
    expect(height!.min).toBe(8)
    expect(height!.max).toBe(200)
  })

  it('round-trips {% spacer height=80 /%} through tiptap and back, height intact', () => {
    const src = '{% spacer height=80 /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const spacer = doc.content.find((n) => n.type === 'spacerBlock')
    expect(spacer).toBeDefined()
    expect(spacer!.attrs!.mdAttrs).toMatchObject({ height: 80 })
    const out = tiptapToMarkdoc(doc)
    expect(out).toContain('{% spacer height=80 /%}')
  })

  it('a bare {% spacer /%} stays self-closing and attribute-free', () => {
    const doc = markdocToTiptap('{% spacer /%}\n', KNOWN)
    const spacer = doc.content.find((n) => n.type === 'spacerBlock')
    expect(spacer).toBeDefined()
    expect(spacer!.attrs!.mdAttrs).toEqual({})
    const out = tiptapToMarkdoc(doc)
    expect(out).toContain('{% spacer /%}')
    // no phantom body / closing tag
    expect(out).not.toContain('{% /spacer %}')
  })

  it('reopen is byte-stable: serialize → parse → serialize is a fixed point', () => {
    const src = 'Above.\n\n{% spacer height=120 /%}\n\nBelow.\n'
    const once = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    const twice = tiptapToMarkdoc(markdocToTiptap(once, KNOWN))
    expect(twice).toBe(once)
    expect(once).toContain('{% spacer height=120 /%}')
  })
})
