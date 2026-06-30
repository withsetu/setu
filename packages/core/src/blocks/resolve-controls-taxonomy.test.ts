import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resolveControls } from './resolve-controls'

describe('resolveControls — taxonomy picker hints', () => {
  it('accepts category/tag hints on (non-enum) string props', () => {
    const props = z.object({ category: z.string().optional(), tag: z.string().optional() })
    expect(resolveControls(props, { category: 'category', tag: 'tag' })).toEqual([
      { name: 'category', control: 'category' },
      { name: 'tag', control: 'tag' },
    ])
  })

  it('rejects a category hint on a non-string prop', () => {
    expect(() => resolveControls(z.object({ n: z.number() }), { n: 'category' })).toThrow()
  })

  it('rejects a tag hint on an enum string prop', () => {
    expect(() => resolveControls(z.object({ s: z.enum(['a', 'b']) }), { s: 'tag' })).toThrow()
  })
})
