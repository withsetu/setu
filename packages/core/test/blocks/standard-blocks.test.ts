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
    // #1125: `required` reflects the zod wrapper — button's `href` is a bare z.string() and
    // therefore required, `variant` has a .default() and is not. A real block contract with a
    // required prop, which is why the flag is not a collections-only concern.
    expect(markdocAttributesFor(button!.contract.props)).toEqual({
      href: { type: 'String', required: true },
      variant: {
        type: 'String',
        matches: ['primary', 'secondary'],
        default: 'primary',
        required: false
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
