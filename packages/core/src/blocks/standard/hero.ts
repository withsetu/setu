import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

export const heroBlock: StandardBlock = {
  tag: 'hero',
  renderer: '@setu/blocks/hero.astro',
  contract: defineBlock({
    props: z.object({
      headline: z.string(),
      subhead: z.string().optional(),
      image: z.string().optional(),
      ctaLabel: z.string().optional(),
      ctaHref: z.string().optional(),
      variant: z.enum(['left', 'center']).default('center'),
    }),
    editor: {
      label: 'Hero',
      icon: 'hero',
      group: 'marketing',
      keywords: ['hero', 'banner', 'cta', 'header'],
      controls: { headline: 'text', subhead: 'textarea', image: 'media', ctaLabel: 'text', ctaHref: 'url', variant: 'select' },
    },
  }),
}
