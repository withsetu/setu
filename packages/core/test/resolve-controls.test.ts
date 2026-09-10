import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveControls } from '../src/blocks/resolve-controls'

describe('resolveControls', () => {
  const props = z.object({
    headline: z.string(),
    subhead: z.string().optional(),
    count: z.number().default(3),
    featured: z.boolean().default(false),
    variant: z.enum(['left', 'center']).default('center')
  })

  it('derives controls from zod when no hints given', () => {
    const out = resolveControls(props)
    // #1125: `required` mirrors the zod wrapper — only the bare `headline` is required here.
    expect(out).toEqual([
      { name: 'headline', control: 'text', required: true },
      { name: 'subhead', control: 'text', required: false },
      { name: 'count', control: 'number', default: 3, required: false },
      { name: 'featured', control: 'switch', default: false, required: false },
      {
        name: 'variant',
        control: 'select',
        default: 'center',
        options: ['left', 'center'],
        required: false
      }
    ])
  })

  it('lets a hint override the zod-derived control (string→textarea/media/url)', () => {
    const out = resolveControls(props, {
      subhead: 'textarea',
      headline: 'text'
    })
    expect(out.find((c) => c.name === 'subhead')!.control).toBe('textarea')
  })

  it('throws when a hint names a prop not in the schema', () => {
    expect(() => resolveControls(props, { nope: 'text' })).toThrow(
      /unknown prop/i
    )
  })

  it('throws when a hint is incompatible with the zod type (switch on a string)', () => {
    expect(() => resolveControls(props, { headline: 'switch' })).toThrow(
      /incompatible/i
    )
  })

  it('accepts a color hint on a string prop', () => {
    const p = z.object({ scrim: z.string().optional() })
    expect(resolveControls(p, { scrim: 'color' })).toEqual([
      { name: 'scrim', control: 'color', required: false }
    ])
  })

  it('accepts a locale hint on a string prop (index-backed picker, not a raw box) — #421', () => {
    const p = z.object({ locale: z.string().optional() })
    expect(resolveControls(p, { locale: 'locale' })).toEqual([
      { name: 'locale', control: 'locale', required: false }
    ])
  })

  it('rejects a locale hint on a non-string prop', () => {
    const p = z.object({ count: z.number().default(1) })
    expect(() => resolveControls(p, { count: 'locale' })).toThrow(
      /incompatible/i
    )
  })
})
