import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  listContentEntries,
  parseFrontmatterDate,
  parseMdoc,
  projectRow,
  rowToContentRow,
  runQuery,
  selectPosts
} from '@setu/core'
import type {
  ContentRow,
  DeployInfo,
  Draft,
  IndexQuery,
  PostRow,
  PostsQuery,
  TiptapDoc
} from '@setu/core'
import { resolvePreviewPosts } from '../src/editor/preview-posts'
import { QueryPreview } from '../src/editor/QueryPreview'
import type { QueryAttrs, RunQuery } from '../src/editor/QueryPreview'
import { latestPostsQueryAttrs } from '../src/editor/extensions/LatestPostsBlock'
import type { LatestPostsAttrs } from '../src/editor/extensions/LatestPostsBlock'

// #1245 — the editor canvas preview of the Query / Latest Posts blocks must list the SAME
// entries, in the SAME order, as the published block for the same attributes. The site
// renders those blocks from committed Git content through `selectPosts`
// (blocks/query/query.astro, packages/blocks/src/latest-posts/LatestPosts.astro); the canvas
// reads the content index. This file feeds one fixture through both paths and compares.

// --- fixture: what is committed to Git ------------------------------------------------

const mdoc = (fm: Record<string, string | boolean | string[]>): string => {
  const yaml = Object.entries(fm)
    .map(([k, v]) =>
      Array.isArray(v)
        ? `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}`
        : `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`
    )
    .join('\n')
  return `---\n${yaml}\n---\nBody text.\n`
}

const COMMITTED: { path: string; content: string }[] = [
  {
    path: 'post/en/alpha',
    content: mdoc({ title: 'Alpha', date: '2026-01-10', tags: ['astro'] })
  },
  {
    // Lower-case title: the index lowercases for its own title sort; the site does not.
    path: 'post/en/bravo',
    content: mdoc({
      title: 'bravo',
      date: '2026-03-01',
      categories: ['news']
    })
  },
  // No date → sorts last for newest AND oldest on the site.
  { path: 'post/en/charlie', content: mdoc({ title: 'Charlie' }) },
  {
    // Explicitly unpublished — never on the site.
    path: 'post/en/delta',
    content: mdoc({ title: 'Delta', date: '2026-02-01', published: false })
  },
  {
    // Other locale — only listed when the block asks for `fr`.
    path: 'post/fr/echo',
    content: mdoc({ title: 'Echo', date: '2026-04-01', tags: ['astro'] })
  },
  {
    // Same date as alpha → the site breaks the tie by id.
    path: 'post/en/hotel',
    content: mdoc({
      title: 'Hotel',
      date: '2026-01-10',
      tags: ['astro'],
      categories: ['news']
    })
  },
  {
    // Committed hidden, but the deploy still shows it (lifecycle: live, pending
    // 'unpublishing'). A rebuild drops it, so a status:'published' filter would be wrong.
    path: 'post/en/india',
    content: mdoc({ title: 'India', date: '2026-02-15', published: false })
  },
  // Undated title-sort fodder, and an entry in another collection.
  { path: 'post/en/juliet', content: mdoc({ title: 'juliet' }) },
  {
    path: 'page/en/golf',
    content: mdoc({ title: 'Golf', date: '2026-06-01' })
  },
  {
    path: 'post/fr/kilo',
    content: mdoc({ title: 'Kilo', date: '2026-01-02' })
  }
]

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

const draft = (
  path: string,
  metadata: Record<string, unknown>,
  baseContent: string | null
): Draft => {
  const [collection, locale, slug] = path.split('/') as [string, string, string]
  return {
    collection,
    locale,
    slug,
    content: doc('draft body'),
    metadata,
    baseSha: null,
    baseContent,
    createdAt: 1,
    updatedAt: 2
  }
}

// Local working copies the site can never see: a never-committed draft with the newest date
// of all, and a draft that would RE-publish `delta` (its committed copy is still hidden).
const DRAFTS: Draft[] = [
  draft('post/en/foxtrot', { title: 'Foxtrot', date: '2026-09-01' }, null),
  draft(
    'post/en/delta',
    { title: 'Delta', date: '2026-02-01' },
    COMMITTED.find((c) => c.path === 'post/en/delta')!.content
  )
]

const DEPLOY: DeployInfo = {
  deployedSha: 'deployed',
  changed: [{ path: 'content/post/en/india.mdoc', added: false }]
}

// --- the site path: committed files → toPostRow's projection → selectPosts -------------

/** Mirrors apps/site/src/lib/post-row.ts `toPostRow` for the fields selectPosts reads (the
 *  admin cannot import the site app). Sees committed files only — the site builds from Git. */
const siteRows: PostRow[] = COMMITTED.map(({ path, content }) => {
  const [collection, locale, slug] = path.split('/') as [string, string, string]
  const fm = parseMdoc(content).frontmatter
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    id: path,
    collection,
    locale,
    slug,
    title: typeof fm['title'] === 'string' ? fm['title'] : path,
    date: parseFrontmatterDate(fm),
    published: fm['published'] === false ? false : undefined,
    tags: strs(fm['tags']),
    categories: strs(fm['categories'])
  }
})

/** blocks/query/query.astro's prop defaults, verbatim, handed to selectPosts. */
function siteQueryBlock(a: QueryAttrs): string[] {
  const q: PostsQuery = {
    collection: a.collection ?? 'post',
    locale: a.locale ?? 'en',
    sort: a.sort ?? 'newest',
    limit: a.limit ?? 10,
    offset: a.offset ?? 0
  }
  if (a.category !== undefined) q.category = a.category
  if (a.tag !== undefined) q.tag = a.tag
  return selectPosts(siteRows, q).map((p) => p.id)
}

/** packages/blocks/src/latest-posts/LatestPosts.astro's resolution, verbatim. */
function siteLatestPosts(a: LatestPostsAttrs): string[] {
  const q: PostsQuery = {
    collection: 'post',
    locale: a.locale ?? 'en',
    sort: 'newest',
    limit: Math.min(24, Math.max(1, Number(a.count) || 5)),
    offset: 0
  }
  if (a.category) q.category = a.category
  if (a.tag) q.tag = a.tag
  return selectPosts(siteRows, q).map((p) => p.id)
}

// --- the canvas path: content index rows → the injected RunQuery → the preview ----------

/** The index as the admin sees it: committed entries (with deploy-derived lifecycle) PLUS
 *  this browser's drafts — the browser-built index and the http service's local-draft
 *  overlay both surface those. */
const indexRows = listContentEntries({
  drafts: DRAFTS,
  committed: COMMITTED.map(({ path, content }) => {
    const [collection, locale, slug] = path.split('/') as [
      string,
      string,
      string
    ]
    return { ref: { collection, locale, slug }, content }
  }),
  deploy: DEPLOY
}).map(projectRow)

const indexRunQuery: RunQuery = (q: IndexQuery) => {
  const r = runQuery(indexRows, q)
  return Promise.resolve({ rows: r.rows.map(rowToContentRow), total: r.total })
}

const idOf = (r: ContentRow) =>
  `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`

async function canvas(a: QueryAttrs): Promise<string[]> {
  return (await resolvePreviewPosts(indexRunQuery, a)).rows.map(idOf)
}

const QUERY_CASES: [string, QueryAttrs][] = [
  ['newest (defaults)', {}],
  ['newest, explicit', { collection: 'post', sort: 'newest', limit: 10 }],
  ['oldest', { sort: 'oldest' }],
  ['title', { sort: 'title' }],
  ['fr locale, newest', { locale: 'fr' }],
  ['fr locale, oldest', { locale: 'fr', sort: 'oldest' }],
  ['tag filter', { tag: 'astro' }],
  ['category filter, oldest', { category: 'news', sort: 'oldest' }],
  ['limit 2 offset 1', { limit: 2, offset: 1 }],
  ['limit above the old 1–50 clamp', { limit: 60 }],
  ['limit 0 lists nothing (site clamps at 0, no minimum of 1)', { limit: 0 }],
  ['negative offset clamps to 0', { offset: -3 }],
  ['offset past the end', { offset: 40 }],
  ['other collection', { collection: 'page' }]
]

describe('query block — canvas preview matches the published block (#1245)', () => {
  it.each(QUERY_CASES)('%s', async (_name, attrs) => {
    expect(await canvas(attrs)).toEqual(siteQueryBlock(attrs))
  })

  it('the fixture actually exercises every rule (guards against a vacuous parity)', () => {
    // newest: dated entries by date desc, alpha/hotel tie broken by id, undated last;
    // no draft (foxtrot), unpublished (delta, india) or other-locale (echo, kilo) entry.
    expect(siteQueryBlock({})).toEqual([
      'post/en/bravo',
      'post/en/alpha',
      'post/en/hotel',
      'post/en/charlie',
      'post/en/juliet'
    ])
    expect(siteQueryBlock({ sort: 'oldest' })).toEqual([
      'post/en/alpha',
      'post/en/hotel',
      'post/en/bravo',
      'post/en/charlie',
      'post/en/juliet'
    ])
  })

  it('total counts every site-visible match, not the drafts/unpublished/other-locale rows', async () => {
    const r = await resolvePreviewPosts(indexRunQuery, { limit: 2 })
    expect(r.total).toBe(5)
    expect(r.rows).toHaveLength(2)
  })
})

const LATEST_CASES: [string, LatestPostsAttrs][] = [
  ['zero-config', {}],
  ['count 2', { count: 2 }],
  ['fr', { locale: 'fr' }],
  ['tag', { tag: 'astro' }],
  ['category', { category: 'news' }]
]

describe('latest posts — canvas preview matches the published block (#1245)', () => {
  it.each(LATEST_CASES)('%s', async (_name, attrs) => {
    expect(await canvas(latestPostsQueryAttrs(attrs))).toEqual(
      siteLatestPosts(attrs)
    )
  })
})

describe('QueryPreview renders the site-parity list', () => {
  afterEach(cleanup)

  it('shows the published entries in site order with a site-truth count', async () => {
    render(
      <QueryPreview
        attrs={{ layout: 'list', limit: 3 }}
        runQuery={indexRunQuery}
        showDate
      />
    )
    await waitFor(() =>
      expect(screen.getByText('5 posts · showing 3')).toBeInTheDocument()
    )
    const titles = screen
      .getAllByRole('listitem')
      .map((li) => li.querySelector('p')?.textContent)
    expect(titles).toEqual(['bravo', 'Alpha', 'Hotel'])
  })
})
