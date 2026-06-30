import { describe, it, expect } from 'vitest'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'

// The query block is bodyless (self-closing) and must round-trip as a dedicated leaf
// `queryBlock` node — NOT the generic body-bearing setuBlock (which would inject an empty
// paragraph and re-emit a {% query %}…{% /query %} pair).

const KNOWN = { knownBlockTags: new Set(['query']) }

describe('query block round-trip', () => {
  it('maps {% query /%} to a leaf queryBlock node (no body)', () => {
    const src = '{% query collection="post" category="news" tag="astro" sort="oldest" layout="grid" columns=4 limit=6 offset=2 showImage=false /%}\n'
    const doc = markdocToTiptap(src, KNOWN)
    const block = doc.content!.find((n) => n.type === 'queryBlock')
    expect(block).toBeDefined()
    expect(block!.content).toBeUndefined()
    expect(block!.attrs!.mdAttrs).toMatchObject({
      collection: 'post',
      category: 'news',
      tag: 'astro',
      sort: 'oldest',
      layout: 'grid',
      columns: 4,
      limit: 6,
      offset: 2,
      showImage: false,
    })
  })

  it('re-emits a self-closing {% query … /%} with attributes preserved', () => {
    const src = '{% query collection="post" layout="grid" columns=3 limit=10 /%}\n'
    const out = tiptapToMarkdoc(markdocToTiptap(src, KNOWN))
    expect(out).toContain('{% query')
    expect(out).toContain('columns=3')
    expect(out).toContain('limit=10')
    expect(out).toContain('/%}')
    // No closing tag — it stays a bodyless atom.
    expect(out).not.toContain('{% /query %}')
  })
})
