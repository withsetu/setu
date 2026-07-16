import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** One gallery item: a media-library src plus per-image alt text and an optional
 *  caption. Persisted as a Markdoc Array attribute ({% gallery images=[{…}] /%}). */
export const galleryImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional()
})

export const galleryBlock: StandardBlock = {
  tag: 'gallery',
  renderer: '@setu/blocks/gallery.astro',
  contract: defineBlock({
    props: z.object({
      images: z.array(galleryImageSchema).default([]),
      columns: z.number().min(1).max(6).default(3),
      gap: z.enum(['none', 'small', 'medium', 'large']).default('medium'),
      captions: z.boolean().default(false),
      width: z.enum(['none', 'wide', 'full']).default('none')
    }),
    editor: {
      label: 'Gallery',
      icon: 'gallery',
      group: 'media',
      keywords: ['images', 'grid', 'photos', 'masonry', 'pictures'],
      style: { themeable: ['surface', 'radius'] },
      controls: {
        images: 'media-list',
        columns: 'slider',
        gap: 'select',
        captions: 'switch',
        width: 'align'
      },
      labels: { captions: 'Show Captions' },
      groups: [
        { id: 'content', label: 'Content', controls: ['images'] },
        {
          id: 'layout',
          label: 'Layout',
          controls: ['columns', 'gap', 'width']
        },
        { id: 'style', label: 'Style', controls: ['captions'] }
      ]
    }
  })
}
