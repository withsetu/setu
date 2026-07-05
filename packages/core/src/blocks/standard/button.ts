import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

export const buttonBlock: StandardBlock = {
  tag: 'button',
  renderer: '@setu/blocks/button.astro',
  contract: defineBlock({
    props: z.object({
      href: z.string(),
      variant: z.enum(['primary', 'secondary']).default('primary')
    }),
    editor: {
      label: 'Button',
      icon: 'link',
      group: 'layout',
      keywords: ['btn', 'cta', 'link']
    }
  })
}
