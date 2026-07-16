import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { resolveControls } from '../src/blocks/resolve-controls'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

// The section block (#182): a body-bearing layout wrapper riding the generic setuBlock
// nesting machinery — no bespoke editor node. The registry injects `section` into
// knownBlockTags, mirrored here per the hero/query test pattern.
const KNOWN = { knownBlockTags: new Set(['section', 'callout']) }

describe('section block contract', () => {
  const section = STANDARD_BLOCKS.find((b) => b.tag === 'section')

  it('is registered as a standard block rendered by @setu/blocks', () => {
    expect(section).toBeDefined()
    expect(section!.renderer).toBe('@setu/blocks/section.astro')
  })

  it('slots into the slash menu layout group with the agreed keywords', () => {
    const ed = section!.contract.editor!
    expect(ed.group).toBe('layout')
    expect(ed.keywords).toEqual(
      expect.arrayContaining(['container', 'wrapper', 'band', 'group'])
    )
  })

  it('enums resolve to picker controls, never raw text', () => {
    const out = resolveControls(
      section!.contract.props,
      section!.contract.editor!.controls
    )
    const control = (name: string) => out.find((c) => c.name === name)!
    expect(control('background').control).toBe('select')
    expect(control('background').options).toEqual([
      'none',
      'soft',
      'accent',
      'inverted'
    ])
    expect(control('padding').control).toBe('select')
    expect(control('padding').options).toEqual(['none', 'sm', 'md', 'lg'])
    expect(control('width').control).toBe('align')
    // 'none' is the shared width sentinel across blocks (hero/image align use it) —
    // one vocabulary, no per-block special-casing in canvas/theme CSS.
    expect(control('width').options).toEqual(['none', 'wide', 'full'])
    expect(control('image').control).toBe('media')
  })

  it('declares Layout/Style inspector groups', () => {
    const labels = section!.contract.editor!.groups!.map((g) => g.label)
    expect(labels).toEqual(['Layout', 'Style'])
  })
})

describe('section block round-trip', () => {
  it('maps {% section %} to a body-bearing setuBlock node', () => {
    const src = `{% section background="soft" padding="lg" width="full" %}
Inside the band.
{% /section %}
`
    const doc = markdocToTiptap(src, KNOWN)
    const node = doc.content.find((n) => n.type === 'setuBlock')
    expect(node).toBeDefined()
    expect(node!.attrs!.tag).toBe('section')
    expect(node!.attrs!.mdAttrs).toEqual({
      background: 'soft',
      padding: 'lg',
      width: 'full'
    })
    expect(node!.content!.length).toBeGreaterThan(0)
  })

  it('is byte-stable on reopen, including a nested callout', () => {
    const src = `{% section background="accent" padding="lg" width="wide" %}
## Grouped heading

Some text inside the section.

{% callout type="info" %}
Nested callout inside a section.
{% /callout %}
{% /section %}
`
    const roundtrip = (s: string) => tiptapToMarkdoc(markdocToTiptap(s, KNOWN))
    const once = roundtrip(src)
    expect(once).toBe(src)
    expect(roundtrip(once)).toBe(once)
  })

  it('an attribute-less {% section %} stays attribute-less', () => {
    const src = `{% section %}
Plain grouped content.
{% /section %}
`
    expect(tiptapToMarkdoc(markdocToTiptap(src, KNOWN))).toBe(src)
  })
})
