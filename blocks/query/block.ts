import { collectionRef, defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    // Any collection declared in setu.config (#1126). The build rejects an undeclared name with
    // a named error (apps/site/test/markdoc-attr-validate.test.ts); the inspector offers the
    // declared collections as a dropdown.
    collection: collectionRef().default('post'),
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
    keywords: [
      'posts',
      'list',
      'query',
      'archive',
      'blog',
      'loop',
      'feed',
      'collection'
    ],
    // collection is a collectionRef → the declared-collections dropdown (WordPress Query Loop's
    // "Post type"); sort/layout are enums → SegmentedSelect; category/tag are searchable taxonomy
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
      limit: 'Number of items',
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
