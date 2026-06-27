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
  editor: { label: 'Posts', icon: 'info', group: 'widget', keywords: ['list', 'query', 'archive', 'blog'] },
})
