import { describe, it, expect } from 'vitest'
import { registry } from '../src/blocks/registry'
import { slashBlocks } from '../src/editor/blocks'

describe('block registry (folder discovery)', () => {
  it('discovers the callout folder block', () => {
    expect(registry.knownBlockTags.has('callout')).toBe(true)
    expect(registry.blocksByTag.get('callout')?.editor?.label).toBe('Callout')
  })
  it('offers folder blocks in the slash menu', () => {
    expect(slashBlocks().some((b) => /callout/i.test(b.title))).toBe(true)
  })
})
