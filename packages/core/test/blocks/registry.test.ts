import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineBlock } from '../../src/blocks/define-block'
import { buildRegistry } from '../../src/blocks/registry'

describe('defineBlock + buildRegistry', () => {
  it('builds a registry from folder entries, carrying scope', () => {
    const contract = defineBlock({
      props: z.object({ title: z.string().optional() }),
      editor: { label: 'Card', icon: 'card' },
      scope: ['post'],
    })
    const reg = buildRegistry([{ tag: 'card', component: 'blocks/card/card.astro', contract }])
    expect([...reg.knownBlockTags]).toEqual(['card'])
    const card = reg.blocksByTag.get('card')!
    expect(card.tag).toBe('card')
    expect(card.component).toBe('blocks/card/card.astro')
    expect(card.editor).toEqual({ label: 'Card', icon: 'card' })
    expect(card.scope).toEqual(['post'])
  })
  it('throws on a duplicate tag across folders', () => {
    const c = defineBlock({ props: z.object({}) })
    expect(() =>
      buildRegistry([
        { tag: 'card', component: 'a', contract: c },
        { tag: 'card', component: 'b', contract: c },
      ]),
    ).toThrow(/Duplicate block tag/)
  })
})
