import { describe, it, expect } from 'vitest'
import { heroBlock } from '../src/blocks/standard/hero'
import { resolveControls } from '../src/blocks/resolve-controls'

describe('hero contract', () => {
  it('uses position9 for textPosition and align for width', () => {
    const out = resolveControls(heroBlock.contract.props, heroBlock.contract.editor!.controls)
    expect(out.find((c) => c.name === 'textPosition')!.control).toBe('position9')
    expect(out.find((c) => c.name === 'width')!.control).toBe('align')
  })
  it('declares Content/Layout/Style groups', () => {
    const labels = heroBlock.contract.editor!.groups!.map((g) => g.label)
    expect(labels).toEqual(['Content', 'Layout', 'Style'])
  })
})
