import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveControls } from '../src/blocks/resolve-controls'

describe('resolveControls', () => {
  const props = z.object({
    headline: z.string(),
    subhead: z.string().optional(),
    count: z.number().default(3),
    featured: z.boolean().default(false),
    variant: z.enum(['left', 'center']).default('center'),
  })

  it('derives controls from zod when no hints given', () => {
    const out = resolveControls(props)
    expect(out).toEqual([
      { name: 'headline', control: 'text' },
      { name: 'subhead', control: 'text' },
      { name: 'count', control: 'number', default: 3 },
      { name: 'featured', control: 'switch', default: false },
      { name: 'variant', control: 'select', default: 'center', options: ['left', 'center'] },
    ])
  })

  it('lets a hint override the zod-derived control (string→textarea/media/url)', () => {
    const out = resolveControls(props, { subhead: 'textarea', headline: 'text' })
    expect(out.find((c) => c.name === 'subhead')!.control).toBe('textarea')
  })

  it('throws when a hint names a prop not in the schema', () => {
    expect(() => resolveControls(props, { nope: 'text' })).toThrow(/unknown prop/i)
  })

  it('throws when a hint is incompatible with the zod type (switch on a string)', () => {
    expect(() => resolveControls(props, { headline: 'switch' })).toThrow(/incompatible/i)
  })

  it('accepts a color hint on a string prop', () => {
    const p = z.object({ scrim: z.string().optional() })
    expect(resolveControls(p, { scrim: 'color' })).toEqual([{ name: 'scrim', control: 'color' }])
  })
})
