import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

// markdocToTiptap accepts a raw Markdoc string (parses internally — no separate parseMarkdoc needed).
// tiptapToMarkdoc accepts a TiptapDoc and returns a Markdoc string.

const KNOWN = { knownBlockTags: new Set(['hero']) }

describe('hero block', () => {
  it('is registered as a standard block with control hints', () => {
    const hero = STANDARD_BLOCKS.find((b) => b.tag === 'hero')
    expect(hero).toBeDefined()
    expect(hero!.renderer).toBe('@setu/blocks/hero.astro')
    expect(hero!.contract.editor?.group).toBe('marketing')
    expect(hero!.contract.editor?.controls?.image).toBe('media')
  })

  it('round-trips {% hero /%} through tiptap and back', () => {
    const src = '{% hero headline="Welcome" subhead="Build fast" image="/media/2026/06/x.webp" ctaLabel="Start" ctaHref="/start" variant="center" /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const hero = doc.content!.find((n) => n.type === 'heroBlock')
    expect(hero).toBeDefined()
    expect(hero!.attrs!.mdAttrs).toMatchObject({ headline: 'Welcome', variant: 'center', image: '/media/2026/06/x.webp' })
    const out = tiptapToMarkdoc(doc)
    expect(out).toContain('{% hero')
    expect(out).toContain('headline="Welcome"')
    expect(out).toContain('/%}')
  })
})
