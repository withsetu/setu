import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** One gallery item: a media-library src plus per-image alt text and an optional
 *  caption. Persisted as a Markdoc Array attribute ({% gallery images=[{…}] /%}).
 *  `src` rejects every URL scheme except http(s) — a hand-authored
 *  `javascript:`/`data:` src must fail the contract, not reach a renderer
 *  (defense in depth with the renderer's own anchor allowlist, @setu/blocks
 *  safeMediaHref). Root-relative and plain relative paths carry no scheme and pass. */
export const galleryImageSchema = z.object({
  src: z
    .string()
    .refine((s) => !/^[a-z][a-z0-9+.-]*:/i.test(s) || /^https?:\/\//i.test(s), {
      message:
        'src must be http(s) or a relative path — other schemes are not allowed'
    }),
  alt: z.string().optional(),
  caption: z.string().optional()
})

export const galleryBlock: StandardBlock = {
  tag: 'gallery',
  renderer: '@setu/blocks/gallery.astro',
  contract: defineBlock({
    props: z.object({
      images: z.array(galleryImageSchema).default([]),
      layout: z.enum(['grid', 'masonry']).default('grid'),
      columns: z.number().min(1).max(6).default(3),
      gap: z.enum(['none', 'small', 'medium', 'large']).default('medium'),
      captions: z.boolean().default(false),
      /** WP "Expand on click": tiles open a full-size slideshow (#553). Default on. */
      lightbox: z.boolean().default(true),
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
        layout: 'select',
        columns: 'slider',
        gap: 'select',
        captions: 'switch',
        lightbox: 'switch',
        width: 'align'
      },
      labels: { captions: 'Show Captions', lightbox: 'Expand on Click' },
      groups: [
        { id: 'content', label: 'Content', controls: ['images'] },
        {
          id: 'layout',
          label: 'Layout',
          controls: ['layout', 'columns', 'gap', 'width']
        },
        { id: 'style', label: 'Style', controls: ['captions', 'lightbox'] }
      ]
    }
  })
}
