import { z } from 'zod'
import { defineConfig } from './define-config'
import { resolveConfig } from './resolve'

/** The config Saytu ships with when the developer provides none. */
export const defaultConfig = defineConfig({
  blocks: [
    {
      tag: 'callout',
      // Permissive props — attribute-value validation is a later increment; the
      // editor offers the `editor.variants` set, the renderer/theme interprets them.
      props: z.object({
        type: z.string().optional(),
        title: z.string().optional(),
        icon: z.string().optional(),
      }),
      component: './src/components/Callout.astro',
      editor: {
        label: 'Callout',
        icon: 'info',
        group: 'Blocks',
        variants: ['info', 'note', 'success', 'warning', 'danger', 'neutral'],
      },
    },
  ],
})

/** Known-block tag set derived from the default config (used by the round-trip
 *  when no explicit config is supplied). Computed once at module load. */
export const defaultKnownBlockTags = resolveConfig(defaultConfig).knownBlockTags
