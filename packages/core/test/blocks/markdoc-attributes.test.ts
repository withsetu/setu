import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { markdocAttributesFor } from '../../src/blocks/markdoc-attributes'

describe('markdocAttributesFor', () => {
  it('maps string/number/boolean/enum, peeling optional + default', () => {
    const attrs = markdocAttributesFor(
      z.object({
        s: z.string().optional(),
        n: z.number(),
        b: z.boolean().default(true),
        e: z.enum(['a', 'b'])
      })
    )
    // `required` (#1125) is the zod wrapper made explicit: `s` is .optional() and `b` has a
    // .default(), so neither is required of the author; `n` and `e` are bare.
    expect(attrs).toEqual({
      s: { type: 'String', required: false },
      n: { type: 'Number', required: true },
      b: { type: 'Boolean', default: true, required: false },
      e: { type: 'String', matches: ['a', 'b'], required: true }
    })
  })
  it('maps arrays (element validation stays with the zod contract)', () => {
    const attrs = markdocAttributesFor(
      z.object({
        items: z.array(z.object({ src: z.string() })).default([])
      })
    )
    expect(attrs).toEqual({
      items: { type: 'Array', default: [], required: false }
    })
  })
  it('throws on an unsupported zod type', () => {
    expect(() =>
      markdocAttributesFor(z.object({ x: z.record(z.string(), z.string()) }))
    ).toThrow(/unsupported/)
  })
  it('throws when props is not a z.object', () => {
    expect(() => markdocAttributesFor(z.string())).toThrow(/z\.object/)
  })
})
