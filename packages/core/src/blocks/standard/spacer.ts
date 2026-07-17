import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** Adjustable vertical whitespace (#183) — the WordPress Spacer archetype. Childless
 *  atom: {% spacer height=80 /%}. The zod range doubles as the inspector slider's
 *  bounds (resolveControls lifts .min/.max into the control). */
export const spacerBlock: StandardBlock = {
  tag: 'spacer',
  renderer: '@setu/blocks/spacer.astro',
  contract: defineBlock({
    props: z.object({
      height: z.number().min(8).max(200).default(48)
    }),
    editor: {
      label: 'Spacer',
      icon: 'spacer',
      group: 'layout',
      keywords: ['gap', 'space', 'divider', 'vertical', 'whitespace', 'margin'],
      controls: { height: 'slider' },
      labels: { height: 'Height (px)' }
    }
  })
}
