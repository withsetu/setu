import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    collection: z.enum(['post', 'page']).default('post'),
    category: z.string().optional(),
    tag: z.string().optional(),
    locale: z.string().optional(),
    limit: z.number().default(10),
    offset: z.number().default(0),
    sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
    layout: z.enum(['grid', 'list']).default('grid'),
    columns: z.number().default(3),
    showImage: z.boolean().default(true)
  }),
  editor: {
    label: 'Query',
    icon: 'pages',
    group: 'widget',
    keywords: ['posts', 'list', 'query', 'archive', 'blog', 'loop', 'feed'],
    // collection/sort/layout are enums → SegmentedSelect; category/tag are searchable taxonomy
    // pickers; locale is a picker fed by the content index (distinctLocales) — never a raw code
    // box; columns is a slider (grid-only via showWhen). The live preview is the QueryBlock node
    // view; this drives the grouped inspector rail.
    controls: {
      category: 'category',
      tag: 'tag',
      locale: 'locale',
      columns: 'slider'
    },
    labels: {
      collection: 'Source',
      sort: 'Order by',
      layout: 'Display',
      showImage: 'Show featured image',
      limit: 'Number of posts',
      offset: 'Skip first'
    },
    showWhen: { columns: { layout: 'grid' } },
    groups: [
      {
        id: 'content',
        label: 'Content',
        controls: ['collection', 'category', 'tag', 'locale', 'sort']
      },
      {
        id: 'layout',
        label: 'Layout',
        controls: ['layout', 'columns', 'showImage']
      },
      { id: 'pagination', label: 'Pagination', controls: ['limit', 'offset'] }
    ]
  }
})
