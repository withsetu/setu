import { describe, it, expect } from 'vitest'
import { STANDARD_BLOCKS, markdocAttributesFor } from '../../src/index'

describe('STANDARD_BLOCKS', () => {
  const button = STANDARD_BLOCKS.find((b) => b.tag === 'button')

  it('includes the button standard block with its @setu/blocks renderer', () => {
    expect(button).toBeDefined()
    expect(button!.renderer).toBe('@setu/blocks/button.astro')
  })

  it('validates href and defaults variant to primary', () => {
    expect(button!.contract.props.parse({ href: '/x' })).toEqual({
      href: '/x',
      variant: 'primary'
    })
    expect(() => button!.contract.props.parse({})).toThrow()
  })

  it('derives markdoc attributes from the props', () => {
    expect(markdocAttributesFor(button!.contract.props)).toEqual({
      href: { type: 'String' },
      variant: {
        type: 'String',
        matches: ['primary', 'secondary'],
        default: 'primary'
      }
    })
  })

  it('groups the button under layout with a valid icon', () => {
    expect(button!.contract.editor).toMatchObject({
      label: 'Button',
      group: 'layout',
      icon: 'link'
    })
  })
})
