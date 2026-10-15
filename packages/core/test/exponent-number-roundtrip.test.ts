import { describe, it, expect } from 'vitest'
import Markdoc from '@markdoc/markdoc'
import { markdocToTiptap } from '../src/markdoc/to-tiptap'
import { tiptapToMarkdoc } from '../src/markdoc/to-markdoc'
import { plainDecimal } from '../src/markdoc/plain-number'
import type { TiptapDoc } from '../src/markdoc/types'

/**
 * #1252 — JavaScript spells very large and very small numbers in exponent notation
 * (`String(1e21)` is `1e+21`, `String(1e-7)` is `1e-7`), and `Markdoc.format` writes
 * numbers that way. Markdoc's own tag grammar only accepts `-?[0-9]+(.[0-9]+)?`
 * (@markdoc/markdoc src/grammar/tag.pegjs, `ValueNumber`), so the block it just wrote
 * reopened as an "Unparsed Markdoc" passthrough. The writer must spell every number in
 * plain decimal, losslessly.
 */

const known = new Set(['query', 'hero', 'callout', 'columns', 'column'])

/** A doc holding one `{% query /%}` atom block (`queryBlock`) with these props. */
const queryDoc = (mdAttrs: Record<string, unknown>): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'queryBlock', attrs: { mdAttrs } }]
})

const EXPONENT_VALUES = [
  1e21,
  -1e21,
  1.5e300,
  Number.MAX_VALUE,
  1e-7,
  -1e-7,
  1.234e-9,
  Number.MIN_VALUE
]

describe('plainDecimal', () => {
  it('leaves ordinary numbers exactly as String() spells them', () => {
    for (const n of [0, 1, -1, 10, 0.5, -0.25, 123456789, 1e20, 0.000001])
      expect(plainDecimal(n)).toBe(String(n))
  })

  it('spells exponent-notation numbers as plain decimals that parse back to the same value', () => {
    expect(plainDecimal(1e21)).toBe('1000000000000000000000')
    expect(plainDecimal(-1.5e22)).toBe('-15000000000000000000000')
    expect(plainDecimal(1e-7)).toBe('0.0000001')
    expect(plainDecimal(-1.234e-9)).toBe('-0.000000001234')
    for (const n of EXPONENT_VALUES) {
      const s = plainDecimal(n)
      expect(s).toMatch(/^-?[0-9]+(\.[0-9]+)?$/)
      expect(Number(s)).toBe(n)
    }
  })
})

describe('exponent-notation numbers in block attributes (#1252)', () => {
  it('the raw Markdoc writer is the bug: it emits a spelling its own parser rejects', () => {
    // Guards the premise. If a future @markdoc/markdoc spells or parses these
    // differently, this fails and the workaround can be re-evaluated.
    const out = Markdoc.format(
      new Markdoc.Ast.Node('document', {}, [
        new Markdoc.Ast.Node('tag', { limit: 1e21 }, [], 'query')
      ])
    )
    expect(out).toContain('1e+21')
    expect(Markdoc.parse(out).children[0]!.type).toBe('error')
  })

  for (const value of EXPONENT_VALUES) {
    it(`an atom tag holding ${value} reopens as the same block with the same value`, () => {
      const md = tiptapToMarkdoc(queryDoc({ limit: value }))
      expect(md).not.toMatch(/\de[+-]?\d/)
      const reopened = markdocToTiptap(md, { knownBlockTags: known })
      const node = reopened.content[0]!
      expect(node.type).toBe('queryBlock')
      expect(
        (node.attrs?.['mdAttrs'] as Record<string, unknown>)['limit']
      ).toBe(value)
      // insert → save → reopen → save is byte-stable
      expect(tiptapToMarkdoc(reopened)).toBe(md)
    })
  }

  it('numbers nested in array and object attribute values are spelled plainly too', () => {
    const md = tiptapToMarkdoc(
      queryDoc({ ids: [1e21, 2], range: { min: 1e-7, max: 3 } })
    )
    expect(md).toContain('ids=[1000000000000000000000, 2]')
    expect(md).toContain('range={min: 0.0000001, max: 3}')
    const node = markdocToTiptap(md, { knownBlockTags: known }).content[0]!
    expect(node.type).toBe('queryBlock')
    expect(
      tiptapToMarkdoc(markdocToTiptap(md, { knownBlockTags: known }))
    ).toBe(md)
  })

  it('a body-bearing tag holding an exponent number round-trips', () => {
    const src = `{% callout type="info" weight=1000000000000000000000 %}\nBODYTEXT\n{% /callout %}`
    const out = tiptapToMarkdoc(
      markdocToTiptap(src, { knownBlockTags: known })
    ).trimEnd()
    expect(out).toBe(src)
  })

  it('a tag nested inside another tag body round-trips', () => {
    const src = `{% columns %}\n{% column %}\n{% hero title="T" opacity=0.0000001 /%}\n{% /column %}\n{% /columns %}`
    const out = tiptapToMarkdoc(
      markdocToTiptap(src, { knownBlockTags: known })
    ).trimEnd()
    expect(out).toBe(src)
  })

  it('a string that merely looks like an exponent number is left alone', () => {
    const md = tiptapToMarkdoc(queryDoc({ label: '1e+21' }))
    expect(md).toContain('label="1e+21"')
  })

  it('does not mutate the editor attrs it serializes', () => {
    const mdAttrs = { limit: 1e21, nested: [1e-7] }
    tiptapToMarkdoc(queryDoc(mdAttrs))
    expect(mdAttrs).toEqual({ limit: 1e21, nested: [1e-7] })
  })
})
