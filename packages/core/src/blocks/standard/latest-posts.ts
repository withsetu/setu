import { z } from 'zod'
import { defineBlock } from '../define-block'
import type { StandardBlock } from './types'

/** The blog-homepage staple (#192): zero-config "N most recent posts", the query block's
 *  preset-first sibling. Same content-index seam at render time (published entries only —
 *  `published !== false` is the ONLY published-ness signal), a fraction of the knobs. */
export const latestPostsBlock: StandardBlock = {
  tag: 'latest-posts',
  renderer: '@setu/blocks/latest-posts.astro',
  contract: defineBlock({
    props: z.object({
      count: z.number().default(5),
      category: z.string().optional(),
      tag: z.string().optional(),
      layout: z.enum(['list', 'grid']).default('list'),
      // String enum (not a number) so the inspector renders a segmented 2/3 toggle;
      // the renderer coerces. Grid-only via showWhen.
      columns: z.enum(['2', '3']).default('2'),
      showDate: z.boolean().default(true),
      showExcerpt: z.boolean().default(false),
      showImage: z.boolean().default(false)
    }),
    editor: {
      label: 'Latest Posts',
      icon: 'post',
      group: 'dynamic',
      keywords: ['recent', 'blog', 'feed', 'posts', 'index'],
      controls: {
        count: 'number',
        category: 'category',
        tag: 'tag'
      },
      labels: {
        count: 'Number of posts',
        layout: 'Display',
        showDate: 'Show date',
        showExcerpt: 'Show excerpt',
        showImage: 'Show featured image'
      },
      showWhen: { columns: { layout: 'grid' } },
      groups: [
        {
          id: 'content',
          label: 'Content',
          controls: ['count', 'category', 'tag']
        },
        { id: 'layout', label: 'Layout', controls: ['layout', 'columns'] },
        {
          id: 'display',
          label: 'Display',
          controls: ['showDate', 'showExcerpt', 'showImage']
        }
      ]
    }
  })
}
