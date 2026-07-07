import { z } from 'zod'
import { defineConfig } from '../../../src/config/define-config'

export default defineConfig({
  blocks: [
    {
      tag: 'callout',
      props: z.object({ type: z.string().optional() }),
      component: './Callout.astro',
      editor: { label: 'Callout' }
    }
  ]
})
