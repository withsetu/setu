import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { markdocToTiptap, resolveConfig, defaultConfig } from '../../src/index'

describe('config drives the round-trip', () => {
  it('recognizes a block defined in the config as known', () => {
    const { knownBlockTags } = resolveConfig(defaultConfig)
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n', { knownBlockTags })
    expect(doc.content[0]!.type).toBe('callout')
  })

  it('treats a tag absent from the config as passthrough', () => {
    const { knownBlockTags } = resolveConfig({
      blocks: [{ tag: 'hero', props: z.object({}), component: './Hero.astro' }],
    })
    const doc = markdocToTiptap('{% callout type="info" %}\nHi\n{% /callout %}\n', { knownBlockTags })
    expect(doc.content[0]!.type).toBe('passthrough')
  })
})
