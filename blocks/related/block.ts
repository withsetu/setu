import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    posts: z.string(),
    heading: z.string().default('Related'),
    showImage: z.boolean().default(true),
    collection: z.string().default('post'),
    locale: z.string().optional()
  }),
  editor: {
    label: 'Related posts',
    icon: 'info',
    group: 'widget',
    keywords: ['related', 'curated', 'links']
  }
})
