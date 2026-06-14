import { z } from 'zod'
import { defineConfig } from './define-config'
import { resolveConfig } from './resolve'

/** The config Saytu ships with when the developer provides none. */
export const defaultConfig = defineConfig({
  blocks: [
    {
      tag: 'callout',
      props: z.object({
        type: z.enum(['info', 'warning', 'danger']).default('info'),
        title: z.string().optional(),
      }),
      component: './src/components/Callout.astro',
      editor: { label: 'Callout', icon: 'info', group: 'Blocks' },
    },
  ],
})

/** Known-block tag set derived from the default config (used by the round-trip
 *  when no explicit config is supplied). Computed once at module load. */
export const defaultKnownBlockTags = resolveConfig(defaultConfig).knownBlockTags
