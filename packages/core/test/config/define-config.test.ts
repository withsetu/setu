import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineConfig } from '../../src/index'

describe('defineConfig', () => {
  it('returns the config object unchanged (runtime identity)', () => {
    const config = {
      blocks: [
        {
          tag: 'callout',
          props: z.object({ type: z.string().optional() }),
          component: './Callout.astro'
        }
      ]
    }
    expect(defineConfig(config)).toBe(config)
  })
})
