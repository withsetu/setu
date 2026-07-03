import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveConfig } from '../../src/index'

const block = (tag: string) => ({
  tag,
  props: z.object({ type: z.string().optional() }),
  component: `./${tag}.astro`
})

describe('resolveConfig', () => {
  it('indexes blocks and derives knownBlockTags from a valid config', () => {
    const resolved = resolveConfig({
      blocks: [block('callout'), block('hero')]
    })
    expect(resolved.blocks.map((b) => b.tag)).toEqual(['callout', 'hero'])
    expect(resolved.blocksByTag.get('hero')?.component).toBe('./hero.astro')
    expect([...resolved.knownBlockTags]).toEqual(['callout', 'hero'])
  })

  it('resolves an empty blocks array to an empty config', () => {
    const resolved = resolveConfig({ blocks: [] })
    expect(resolved.blocks).toEqual([])
    expect(resolved.knownBlockTags.size).toBe(0)
  })

  it('throws when a block is missing its tag', () => {
    const bad = { blocks: [{ props: z.object({}), component: './x.astro' }] }
    expect(() => resolveConfig(bad)).toThrow(/tag/i)
  })

  it('throws when a block is missing its component', () => {
    const bad = { blocks: [{ tag: 'callout', props: z.object({}) }] }
    expect(() => resolveConfig(bad)).toThrow(/component/i)
  })

  it('throws when props is not a Zod schema', () => {
    const bad = {
      blocks: [
        { tag: 'callout', props: { type: 'string' }, component: './x.astro' }
      ]
    }
    expect(() => resolveConfig(bad)).toThrow(/zod schema/i)
  })

  it('throws on a duplicate block tag, naming the tag', () => {
    expect(() =>
      resolveConfig({ blocks: [block('callout'), block('callout')] })
    ).toThrow(/Duplicate block tag "callout"/)
  })
})
