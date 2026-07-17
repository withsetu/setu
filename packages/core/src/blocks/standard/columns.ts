import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** The five supported column layouts (WordPress Columns presets). Each segment is a
 *  relative width; the renderer turns "33-67" into `33fr 67fr` grid columns. */
export const COLUMN_LAYOUTS = [
  '50-50',
  '33-67',
  '67-33',
  '33-33-33',
  '25-25-25-25'
] as const

export type ColumnLayout = (typeof COLUMN_LAYOUTS)[number]

/** Column count implied by a layout ("33-33-33" → 3). */
export const columnCountFor = (layout: string): number =>
  layout.split('-').length

/** Multi-column layout container: `{% columns %}` holding 2–4 `{% column %}` children,
 *  each of which nests arbitrary blocks (Shape B — see #121). */
export const columnsBlock: StandardBlock = {
  tag: 'columns',
  renderer: '@setu/blocks/columns.astro',
  contract: defineBlock({
    props: z.object({
      layout: z.enum(COLUMN_LAYOUTS).default('50-50'),
      gap: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
      stackOnMobile: z.boolean().default(true)
    }),
    editor: {
      label: 'Columns',
      icon: 'columns',
      group: 'layout',
      keywords: ['grid', 'row', 'split', 'multi-column', 'two', 'three'],
      controls: {
        layout: 'select',
        gap: 'select',
        stackOnMobile: 'switch'
      },
      labels: {
        stackOnMobile: 'Stack on mobile'
      },
      groups: [
        {
          id: 'layout',
          label: 'Layout',
          controls: ['layout', 'gap', 'stackOnMobile']
        }
      ]
    }
  })
}

/** Structural child of `{% columns %}` — a single column slot. Registered as a block so
 *  the site/preview pipelines know its tag, but hidden from the slash menu: it is only
 *  ever created and managed by its parent columns block. */
export const columnBlock: StandardBlock = {
  tag: 'column',
  renderer: '@setu/blocks/column.astro',
  contract: defineBlock({
    props: z.object({}),
    editor: {
      label: 'Column',
      icon: 'columns',
      group: 'layout',
      hidden: true
    }
  })
}
