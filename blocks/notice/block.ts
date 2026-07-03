import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    tone: z.enum(['info', 'warn', 'success']).default('info'),
    title: z.string().optional()
  }),
  editor: {
    label: 'Notice',
    icon: 'info',
    group: 'text',
    keywords: ['banner', 'alert']
  }
})
