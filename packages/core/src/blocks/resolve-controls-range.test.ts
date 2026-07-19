import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveControls } from './resolve-controls'

describe('resolveControls — numeric range extraction (slider bounds)', () => {
  it('carries zod .min/.max/.multipleOf through to the resolved control', () => {
    const props = z.object({
      height: z.number().min(8).max(200).default(48)
    })
    const [height] = resolveControls(props, { height: 'slider' })
    expect(height).toMatchObject({
      name: 'height',
      control: 'slider',
      default: 48,
      min: 8,
      max: 200
    })
    expect(height!.step).toBeUndefined()
  })

  it('maps multipleOf to step', () => {
    const props = z.object({ n: z.number().min(0).max(10).multipleOf(2) })
    const [n] = resolveControls(props, { n: 'slider' })
    expect(n).toMatchObject({ min: 0, max: 10, step: 2 })
  })

  it('an unconstrained number resolves with no range (control falls back)', () => {
    const props = z.object({ columns: z.number().default(3) })
    const [columns] = resolveControls(props, { columns: 'slider' })
    expect(columns!.min).toBeUndefined()
    expect(columns!.max).toBeUndefined()
    expect(columns!.step).toBeUndefined()
  })
})
