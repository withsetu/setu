import { describe, it, expect } from 'vitest'
import { buttonBlock } from './button'
import { heroBlock } from './hero'

describe('standard blocks declare themeable axes', () => {
  it('button is themeable on accent + radius', () => {
    expect(buttonBlock.contract.editor?.style?.themeable).toEqual([
      'accent',
      'radius'
    ])
  })
  it('hero declares its themeable axes', () => {
    expect(heroBlock.contract.editor?.style?.themeable).toContain('accent')
  })
})
