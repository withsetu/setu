import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
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
      layout: z
        .enum(['centered', 'split-left', 'split-right', 'background'])
        .default('centered'),
      textPosition: z.enum(POSITIONS).default('center'),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      width: z.enum(['none', 'wide', 'full']).default('none'),
      overlayColor: z.string().optional(),
      textColor: z.string().optional(),
      parallax: z.boolean().default(false)
    }),
    editor: {
      label: 'Hero',
      icon: 'hero',
      group: 'marketing',
      keywords: ['hero', 'banner', 'cta', 'header'],
      style: { themeable: ['accent', 'surface', 'text', 'typography'] },
      controls: {
        headline: 'text',
        subhead: 'textarea',
        image: 'media',
        ctaLabel: 'text',
        ctaHref: 'url',
        layout: 'select',
        textPosition: 'position9',
        textAlign: 'select',
        width: 'align',
        overlayColor: 'color',
        textColor: 'color',
        parallax: 'switch'
      },
      labels: {
        ctaLabel: 'Button Text',
        ctaHref: 'Button Link',
        textColor: 'Text Color'
      },
      showWhen: {
        overlayColor: { layout: 'background' },
        parallax: { layout: 'background' }
      },
      groups: [
        {
          id: 'content',
          label: 'Content',
          controls: ['headline', 'subhead', 'image', 'ctaLabel', 'ctaHref']
        },
        {
          id: 'layout',
          label: 'Layout',
          controls: ['layout', 'textPosition', 'textAlign', 'width']
        },
        {
          id: 'style',
          label: 'Style',
          controls: ['textColor', 'overlayColor', 'parallax']
        }
      ]
    }
  })
}
