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
    columns: z.number().default(3),
    showImage: z.boolean().default(true),
  }),
  editor: {
    label: 'Query',
    icon: 'pages',
    group: 'widget',
    keywords: ['posts', 'list', 'query', 'archive', 'blog', 'loop', 'feed'],
    // The query block is edited through a dedicated grouped inspector (QueryInspector) with a
    // live in-canvas preview — not the generic auto-form. These hints stay as the source of
    // truth for which taxonomy filters the block exposes.
    controls: { category: 'category', tag: 'tag' },
  },
})
