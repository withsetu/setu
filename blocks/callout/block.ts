import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  // Permissive props — value validation is a later increment; the editor offers the
  // variants, the renderer/theme interprets them.
  props: z.object({
    type: z.string().optional(),
    title: z.string().optional(),
    icon: z.string().optional(),
  }),
  editor: {
    label: 'Callout',
    icon: 'info',
    group: 'Blocks',
    variants: ['info', 'note', 'success', 'warning', 'danger', 'neutral'],
  },
})
