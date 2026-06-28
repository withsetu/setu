import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveControls } from '../src/blocks/resolve-controls'

const POS = ['top-left','top-center','top-right','middle-left','center','middle-right','bottom-left','bottom-center','bottom-right'] as const

describe('resolveControls — rail control types', () => {
  it('upgrades an enum prop to position9 and preserves options', () => {
    const props = z.object({ textPosition: z.enum(POS).default('center') })
    const out = resolveControls(props, { textPosition: 'position9' })
    expect(out).toHaveLength(1)
    const c = out[0]!
    expect(c.name).toBe('textPosition')
    expect(c.control).toBe('position9')
    expect(c.options).toEqual([...POS])
    expect(c.default).toBe('center')
  })

  it('upgrades an enum prop to align', () => {
    const props = z.object({ width: z.enum(['none','wide','full']).default('none') })
    const out = resolveControls(props, { width: 'align' })
    expect(out).toHaveLength(1)
    expect(out[0]!.control).toBe('align')
    expect(out[0]!.options).toEqual(['none','wide','full'])
    expect(out[0]!.default).toBe('none')
  })

  it('throws when position9 hints a non-enum String prop', () => {
    const props = z.object({ headline: z.string() })
    expect(() => resolveControls(props, { headline: 'position9' as never })).toThrow(/incompatible/)
  })
})
