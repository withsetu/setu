import { describe, it, expect } from 'vitest'
import { ATOM_TAG_TO_NODE, ATOM_NODE_TO_TAG } from '../src/markdoc/atom-blocks'
import { markdocToTiptap, tiptapToMarkdoc } from '../src/index'
import type { TiptapDoc } from '../src/markdoc/types'

// The atom map is the single source of truth that drives BOTH markdoc converters for
// the childless (props-only, self-closing) blocks. These tests guard that the two
// derived directions stay a clean bijection and that every atom actually round-trips.

describe('atom block tag<->node map', () => {
  it('is a clean bijection (reverse is exact, no collisions)', () => {
    const tags = Object.keys(ATOM_TAG_TO_NODE)
    const nodes = Object.values(ATOM_TAG_TO_NODE)
    // No duplicate node types (a collision would make the reverse lookup ambiguous).
    expect(new Set(nodes).size).toBe(nodes.length)
    // ATOM_NODE_TO_TAG is the exact inverse of ATOM_TAG_TO_NODE.
    expect(Object.keys(ATOM_NODE_TO_TAG).length).toBe(tags.length)
    for (const [tag, node] of Object.entries(ATOM_TAG_TO_NODE)) {
      expect(ATOM_NODE_TO_TAG[node]).toBe(tag)
    }
  })

  it('drives markdoc -> tiptap for every atom tag', () => {
    const known = { knownBlockTags: new Set(Object.keys(ATOM_TAG_TO_NODE)) }
    for (const [tag, node] of Object.entries(ATOM_TAG_TO_NODE)) {
      const doc = markdocToTiptap(`{% ${tag} title="X" /%}\n`, known)
      const atom = doc.content.find((n) => n.type === node)
      expect(atom, `tag "${tag}" should parse to node "${node}"`).toBeDefined()
      expect(atom!.attrs!.mdAttrs).toMatchObject({ title: 'X' })
    }
  })

  it('drives tiptap -> markdoc for every atom node', () => {
    for (const [tag, node] of Object.entries(ATOM_TAG_TO_NODE)) {
      const doc: TiptapDoc = {
        type: 'doc',
        content: [{ type: node, attrs: { mdAttrs: { title: 'X' } } }]
      }
      const out = tiptapToMarkdoc(doc)
      expect(out, `node "${node}" should serialize to tag "${tag}"`).toContain(
        `{% ${tag} title="X" /%}`
      )
    }
  })

  it('round-trips every atom tag byte-stably (markdoc -> tiptap -> markdoc)', () => {
    const known = { knownBlockTags: new Set(Object.keys(ATOM_TAG_TO_NODE)) }
    for (const tag of Object.keys(ATOM_TAG_TO_NODE)) {
      const src = `{% ${tag} title="X" count=3 /%}\n`
      const out = tiptapToMarkdoc(markdocToTiptap(src, known))
      expect(out, `tag "${tag}" should round-trip byte-stably`).toBe(src)
    }
  })
})
