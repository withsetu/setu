import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { markdocToTiptap, resolveConfig } from '../../src/index'

describe('config drives the round-trip', () => {
  it('recognizes a block defined in the config as known', () => {
    const { knownBlockTags } = resolveConfig({
      blocks: [
        { tag: 'callout', props: z.object({}), component: './Callout.astro' }
      ]
    })
    const doc = markdocToTiptap(
      '{% callout type="info" %}\nHi\n{% /callout %}\n',
      { knownBlockTags }
    )
    expect(doc.content[0]!.type).toBe('callout')
  })

  it('treats a tag absent from the config as passthrough, preserving its source', () => {
    // config defines only 'hero', so the callout tag below is unknown → passthrough
    const { knownBlockTags } = resolveConfig({
      blocks: [{ tag: 'hero', props: z.object({}), component: './Hero.astro' }]
    })
    const doc = markdocToTiptap(
      '{% callout type="info" %}\nHi\n{% /callout %}\n',
      { knownBlockTags }
    )
    const node = doc.content[0]!
    expect(node.type).toBe('passthrough')
    expect((node.attrs as { raw: string }).raw).toContain(
      '{% callout type="info" %}'
    )
  })
})
