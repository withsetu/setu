import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    collection: z.string().default('post'),
    category: z.string().optional(),
    tag: z.string().optional(),
    locale: z.string().optional(),
    limit: z.number().default(10),
    offset: z.number().default(0),
    sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
    layout: z.enum(['grid', 'list']).default('grid'),
    showImage: z.boolean().default(true),
  }),
  editor: {
    label: 'Query block',
    icon: 'info',
    group: 'widget',
    keywords: ['posts', 'list', 'query', 'archive', 'blog', 'loop'],
    // Render the taxonomy filters as searchable pickers in the block inspector
    // (not raw text inputs). collection/sort/layout fall back to selects from their enums.
    controls: { category: 'category', tag: 'tag' },
  },
})
