import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resolveControls } from '../../src/blocks/resolve-controls'

/**
 * #1125: a collection's declared fields are served to the admin through `resolveControls`, and the
 * admin has to know which of them are REQUIRED. Without it the entry form cannot tell an editor
 * why a save was refused — which is the exact failure the #962 spike measured: creating a product
 * returned a 422 naming seven required fields, none of which the admin had a control for.
 *
 * The distinction lives in zod and was being discarded: `unwrap` peels ZodOptional and ZodDefault
 * to find the inner type, and nothing recorded that it had peeled an Optional.
 *
 * A field with a DEFAULT is not required of the author — the schema supplies the value — so it
 * reports required: false alongside its default. That is the case most likely to be got wrong.
 */
describe('resolveControls: required', () => {
  const controls = resolveControls(
    z.object({
      sku: z.string(),
      stock: z.enum(['in-stock', 'made-to-order']),
      priceUsd: z.number(),
      note: z.string().optional(),
      featured: z.boolean().default(false),
      tier: z.enum(['a', 'b']).optional()
    })
  )
  const byName = new Map(controls.map((c) => [c.name, c]))

  it('a bare field is required', () => {
    expect(byName.get('sku')?.required).toBe(true)
    expect(byName.get('stock')?.required).toBe(true)
    expect(byName.get('priceUsd')?.required).toBe(true)
  })

  it('an .optional() field is not', () => {
    expect(byName.get('note')?.required).toBe(false)
    expect(byName.get('tier')?.required).toBe(false)
  })

  it('a field with a .default() is not required, and still reports its default', () => {
    expect(byName.get('featured')?.required).toBe(false)
    expect(byName.get('featured')?.default).toBe(false)
  })

  it('required-ness does not disturb the control derivation', () => {
    expect(byName.get('sku')?.control).toBe('text')
    expect(byName.get('stock')?.control).toBe('select')
    expect(byName.get('stock')?.options).toEqual(['in-stock', 'made-to-order'])
    expect(byName.get('priceUsd')?.control).toBe('number')
    expect(byName.get('featured')?.control).toBe('switch')
  })
})
