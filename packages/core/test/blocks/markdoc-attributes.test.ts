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
        e: z.enum(['a', 'b']),
      }),
    )
    expect(attrs).toEqual({
      s: { type: 'String' },
      n: { type: 'Number' },
      b: { type: 'Boolean', default: true },
      e: { type: 'String', matches: ['a', 'b'] },
    })
  })
  it('throws on an unsupported zod type', () => {
    expect(() => markdocAttributesFor(z.object({ x: z.array(z.string()) }))).toThrow(/unsupported/)
  })
  it('throws when props is not a z.object', () => {
    expect(() => markdocAttributesFor(z.string())).toThrow(/z\.object/)
  })
})
