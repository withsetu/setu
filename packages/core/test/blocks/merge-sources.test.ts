import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { mergeBlockSources } from '../../src/blocks/merge-sources'
import { defineBlock } from '../../src/blocks/define-block'
import type { StandardBlock } from '../../src/blocks/standard/types'

const std: StandardBlock[] = [
  { tag: 'button', renderer: '@setu/blocks/button.astro', contract: defineBlock({ props: z.object({ href: z.string() }) }) },
]

describe('mergeBlockSources', () => {
  it('carries a standard block in with its @setu/blocks renderer as component', () => {
    const out = mergeBlockSources({ standard: std, local: [] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ tag: 'button', component: '@setu/blocks/button.astro' })
    expect(out[0].contract).toBe(std[0].contract)
  })

  it('lets a site-local folder block override a standard block by tag', () => {
    const localContract = defineBlock({ props: z.object({ href: z.string(), extra: z.string().optional() }) })
    const out = mergeBlockSources({
      standard: std,
      local: [{ tag: 'button', component: 'blocks/button/button.astro', contract: localContract }],
    })
    expect(out).toHaveLength(1)
    expect(out[0].component).toBe('blocks/button/button.astro')
    expect(out[0].contract).toBe(localContract)
  })

  it('unions standard and local blocks', () => {
    const out = mergeBlockSources({
      standard: std,
      local: [{ tag: 'callout', component: 'blocks/callout/callout.astro', contract: defineBlock({ props: z.object({}) }) }],
    })
    expect(out.map((e) => e.tag).sort()).toEqual(['button', 'callout'])
  })
})
