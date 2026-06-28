import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const

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
      layout: z.enum(['centered', 'split-left', 'split-right', 'background']).default('centered'),
      textPosition: z.enum(POSITIONS).default('center'),
      width: z.enum(['none', 'wide', 'full']).default('none'),
      overlayColor: z.string().optional(),
      parallax: z.boolean().default(false),
    }),
    editor: {
      label: 'Hero', icon: 'hero', group: 'marketing',
      keywords: ['hero', 'banner', 'cta', 'header'],
      controls: {
        headline: 'text', subhead: 'textarea', image: 'media', ctaLabel: 'text', ctaHref: 'url',
        layout: 'select', textPosition: 'position9', width: 'align', overlayColor: 'color', parallax: 'switch',
      },
      showWhen: { overlayColor: { layout: 'background' }, parallax: { layout: 'background' } },
      groups: [
        { id: 'content', label: 'Content', controls: ['headline', 'subhead', 'image', 'ctaLabel', 'ctaHref'] },
        { id: 'layout', label: 'Layout', controls: ['layout', 'textPosition', 'width'] },
        { id: 'style', label: 'Style', controls: ['overlayColor', 'parallax'] },
      ],
    },
  }),
}
