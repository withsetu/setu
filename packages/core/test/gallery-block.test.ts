import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS } from '../src/blocks/standard'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

const KNOWN = { knownBlockTags: new Set(['gallery']) }

describe('gallery block', () => {
  it('is registered as a standard block with the @setu/blocks renderer', () => {
    const gallery = STANDARD_BLOCKS.find((b) => b.tag === 'gallery')
    expect(gallery).toBeDefined()
    expect(gallery!.renderer).toBe('@setu/blocks/gallery.astro')
    expect(gallery!.contract.editor?.controls?.images).toBe('media-list')
  })

  it('maps {% gallery /%} to a galleryBlock atom node with array attrs intact', () => {
    const src =
      '{% gallery\n   images=[{src: "/media/2026/07/a.webp", alt: "A"}, {src: "/media/2026/07/b.webp", caption: "By the sea"}]\n   columns=4\n   captions=true /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const gallery = doc.content.find((n) => n.type === 'galleryBlock')
    expect(gallery).toBeDefined()
    const md = gallery!.attrs!.mdAttrs as Record<string, unknown>
    expect(md.columns).toBe(4)
    expect(md.captions).toBe(true)
    expect(md.images).toEqual([
      { src: '/media/2026/07/a.webp', alt: 'A' },
      { src: '/media/2026/07/b.webp', caption: 'By the sea' }
    ])
  })

  it('serializes back to a self-closing {% gallery /%} tag', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'galleryBlock',
          attrs: {
            mdAttrs: {
              images: [{ src: '/media/a.webp', alt: 'A' }],
              columns: 2
            }
          }
        }
      ]
    }
    const out = tiptapToMarkdoc(doc)
    expect(out).toContain('{% gallery')
    expect(out).toContain('/%}')
    expect(out).not.toContain('{% /gallery %}')
    expect(out).toContain('images=')
    expect(out).toContain('columns=2')
  })

  it('round-trips byte-stable: markdoc -> tiptap -> markdoc', () => {
    const src =
      '{% gallery\n   images=[{src: "/media/2026/07/a.webp", alt: "A"}, {src: "/media/2026/07/b.webp"}]\n   columns=3\n   gap="small" /%}\n'
    const once = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    const twice = tiptapToMarkdoc(markdocToTiptap(once, KNOWN))
    expect(twice).toBe(once)
    // and the attrs survive the cycle
    const doc = markdocToTiptap(once, KNOWN)
    const md = doc.content.find((n) => n.type === 'galleryBlock')!.attrs!
      .mdAttrs as Record<string, unknown>
    expect(md.images).toEqual([
      { src: '/media/2026/07/a.webp', alt: 'A' },
      { src: '/media/2026/07/b.webp' }
    ])
    expect(md.gap).toBe('small')
  })

  it('an empty gallery round-trips as a bare self-closing tag', () => {
    const src = '{% gallery /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    expect(doc.content[0]!.type).toBe('galleryBlock')
    expect(tiptapToMarkdoc(doc)).toBe(src)
  })
})
