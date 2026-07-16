import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** The `{% section %}` layout wrapper (#182) — a WordPress Group/Cover-style band that
 *  groups arbitrary blocks with a themed background, padding, and width. Body-bearing:
 *  it rides the generic setuBlock editor node (content: 'block+'), so its children are
 *  edited in place. Backgrounds are token presets only — no free hex color — per the
 *  19-token styling contract (docs/block-styling-contract.md). */
export const sectionBlock: StandardBlock = {
  tag: 'section',
  renderer: '@setu/blocks/section.astro',
  contract: defineBlock({
    props: z.object({
      background: z
        .enum(['none', 'soft', 'accent', 'inverted'])
        .default('none'),
      image: z.string().optional(),
      padding: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
      width: z.enum(['normal', 'wide', 'full']).default('normal')
    }),
    editor: {
      label: 'Section',
      icon: 'layers',
      group: 'layout',
      keywords: ['container', 'wrapper', 'band', 'group'],
      style: { themeable: ['accent', 'surface', 'text', 'radius'] },
      controls: {
        background: 'select',
        image: 'media',
        padding: 'select',
        width: 'align'
      },
      labels: { image: 'Background Image' },
      groups: [
        { id: 'layout', label: 'Layout', controls: ['width', 'padding'] },
        { id: 'style', label: 'Style', controls: ['background', 'image'] }
      ]
    }
  })
}
