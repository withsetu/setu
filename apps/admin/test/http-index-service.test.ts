import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { INDEX_VERSION, serializeMdoc, tiptapToMarkdoc } from '@setu/core'
import type {
  ContentRow,
  DeployInfo,
  DraftInput,
  EntryRef,
  IndexQuery,
  MediaUsage,
  TiptapDoc
} from '@setu/core'
import { createHttpIndexService } from '../src/data/http-index-service'

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

const draftInput = (
  slug: string,
  metadata: Record<string, unknown>,
  text = slug
): DraftInput => ({
  collection: 'post',
  locale: 'en',
  slug,
  content: doc(text),
  metadata
})

/** The committed .mdoc a publish of this draft input would write — lets tests
 *  build the "draft equals committed" (just published) state byte-exactly. */
const committedOf = (d: DraftInput): string =>
  serializeMdoc({ frontmatter: d.metadata, body: tiptapToMarkdoc(d.content) })

const serverRow = (
  slug: string,
  over: Partial<ContentRow> = {}
): ContentRow => ({
  ref: { collection: 'post', locale: 'en', slug },
  title: slug,
  locale: 'en',
  lifecycle: { state: 'staged' },
  updatedAt: null,
  hasDraft: false,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  ...over
})

interface Call {
  url: URL
  method: string
}

/** Route-level fetch stub. `routes` maps a pathname to a body factory; set
 *  `failing.on = true` to simulate the network dropping (every call rejects). */
function makeHarness(opts: {
  routes?: Record<string, (url: URL) => unknown>
  drafts?: DraftInput[]
  files?: { path: string; content: string }[]
  deploy?: DeployInfo
}) {
  const calls: Call[] = []
  const failing = { on: false }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, method: init?.method ?? 'GET' })
    if (failing.on) throw new TypeError('network down')
    const route = opts.routes?.[url.pathname]
    if (!route) return { ok: false, status: 404 } as Response
    const body = route(url)
    return {
      ok: true,
      status: 200,
      json: async () => body
    } as unknown as Response
  }) as typeof fetch
  const data = createMemoryDataPort(opts.drafts ?? [])
  const git = createMemoryGitPort(opts.files ?? [])
  const index = createMemoryIndexPort()
  const service = createHttpIndexService({
    apiBase: 'http://api',
    fetchImpl,
    data,
    git,
    index,
    deploy: () => opts.deploy ?? { deployedSha: null, changed: [] }
  })
  return { service, data, git, index, calls, failing }
}

const q = (over: Partial<IndexQuery> = {}): IndexQuery => ({
  collection: 'post',
  offset: 0,
  limit: 50,
  ...over
})

describe('createHttpIndexService · query', () => {
  it('serves server rows and falls back to the cached copy when the network drops', async () => {
    const { service, calls, failing } = makeHarness({
      routes: {
        '/api/index/query': () => ({
          rows: [serverRow('a', { title: 'Alpha' })],
          total: 1
        })
      }
    })
    const first = await service.query(q())
    expect(first.total).toBe(1)
    expect(first.rows[0]!.title).toBe('Alpha')
    expect(calls[0]!.url.pathname).toBe('/api/index/query')
    expect(calls[0]!.url.searchParams.get('collection')).toBe('post')

    failing.on = true
    const offline = await service.query(q())
    expect(offline.total).toBe(1)
    expect(offline.rows[0]!.title).toBe('Alpha')
  })

  it('flushes a pre-existing locally-built index before its first cache use', async () => {
    const { service, index, failing } = makeHarness({
      routes: {
        '/api/index/query': () => ({ rows: [serverRow('fresh')], total: 1 })
      }
    })
    // A leftover from the pre-#464 regime: a full locally-built index.
    await index.upsert({
      key: 'post\0en\0stale',
      collection: 'post',
      locale: 'en',
      slug: 'stale',
      title: 'Stale',
      titleLower: 'stale',
      status: 'draft',
      updatedAt: 1,
      hasDraft: true,
      date: null,
      tags: [],
      categories: [],
      mediaRefs: [],
      audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 }
    })
    await index.setMeta({ indexedSha: 'old', version: INDEX_VERSION })
    await service.query(q())
    failing.on = true
    const offline = await service.query(q())
    expect(offline.rows.map((r) => r.ref.slug)).toEqual(['fresh'])
  })

  it('overlays a local draft on its server row: draft fields win, pending re-derived', async () => {
    const base = draftInput('a', { title: 'Alpha' })
    const edited = draftInput('a', { title: 'Alpha v2' }, 'changed body')
    const { service } = makeHarness({
      routes: {
        '/api/index/query': () => ({
          rows: [serverRow('a', { title: 'Alpha' })],
          total: 1
        })
      },
      files: [{ path: 'content/post/en/a.mdoc', content: committedOf(base) }],
      drafts: [edited]
    })
    const r = await service.query(q())
    expect(r.total).toBe(1)
    const row = r.rows[0]!
    expect(row.title).toBe('Alpha v2')
    expect(row.hasDraft).toBe(true)
    expect(row.lifecycle).toEqual({ state: 'staged', pending: 'edited' })
    expect(row.updatedAt).not.toBeNull()
  })

  it('a just-published draft (byte-equal to committed) carries no pending marker', async () => {
    const d = draftInput('a', { title: 'Alpha' })
    const { service } = makeHarness({
      routes: {
        '/api/index/query': () => ({
          rows: [serverRow('a', { title: 'Alpha' })],
          total: 1
        })
      },
      files: [{ path: 'content/post/en/a.mdoc', content: committedOf(d) }],
      drafts: [d]
    })
    const row = (await service.query(q())).rows[0]!
    expect(row.hasDraft).toBe(true)
    expect(row.lifecycle).toEqual({ state: 'staged' })
  })

  it('injects local-only drafts at the top of the first page and counts them on every page', async () => {
    const { service } = makeHarness({
      routes: {
        '/api/index/query': (url) =>
          url.searchParams.get('offset') === '0'
            ? { rows: [serverRow('a')], total: 1 }
            : { rows: [], total: 1 }
      },
      drafts: [draftInput('b', { title: 'Bravo' })]
    })
    const page0 = await service.query(q())
    expect(page0.total).toBe(2)
    expect(page0.rows.map((r) => r.ref.slug)).toEqual(['b', 'a'])
    expect(page0.rows[0]!.lifecycle).toEqual({ state: 'draft' })
    // Page 2: the draft-only row is not re-injected (no duplicates), but the
    // total still counts it so the pager stays consistent.
    const page1 = await service.query(q({ offset: 50 }))
    expect(page1.total).toBe(2)
    expect(page1.rows).toEqual([])
  })

  it('local-only drafts respect the query filters', async () => {
    const routes = {
      '/api/index/query': () => ({ rows: [], total: 0 })
    }
    const drafts = [draftInput('b', { title: 'Hello world' })]
    const { service } = makeHarness({ routes, drafts })
    expect((await service.query(q({ q: 'zzz' }))).total).toBe(0)
    expect((await service.query(q({ status: 'live' }))).total).toBe(0)
    const match = await service.query(q({ q: 'hello' }))
    expect(match.total).toBe(1)
    expect(match.rows[0]!.title).toBe('Hello world')
  })

  it('splits an over-cap limit into multiple server pages (ReadingSettings asks for 1000)', async () => {
    const mkRows = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => serverRow(`p${from + i}`))
    const { service, calls } = makeHarness({
      routes: {
        '/api/index/query': (url) => {
          const offset = Number(url.searchParams.get('offset'))
          return offset === 0
            ? { rows: mkRows(0, 100), total: 150 }
            : { rows: mkRows(100, 50), total: 150 }
        }
      }
    })
    const r = await service.query(q({ limit: 1000 }))
    expect(r.total).toBe(150)
    expect(r.rows).toHaveLength(150)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url.searchParams.get('limit')).toBe('100')
    expect(calls[1]!.url.searchParams.get('offset')).toBe('100')
  })
})

describe('createHttpIndexService · facets', () => {
  const facetRoutes = {
    '/api/index/facets': (url: URL) => ({
      distinctTags: url.searchParams.get('tagPrefix') === 'v' ? [] : ['react'],
      distinctLocales: ['en'],
      categoryCounts: { guides: 1 },
      tagCounts: { react: 2 }
    })
  }

  it('passes facets through and unions local draft tags/locales', async () => {
    const { service, calls } = makeHarness({
      routes: facetRoutes,
      drafts: [
        {
          ...draftInput('b', { title: 'B', tags: ['Vue'] }),
          locale: 'fr'
        }
      ]
    })
    expect(await service.distinctTags('', 50)).toEqual(['react', 'vue'])
    expect(await service.distinctTags('v', 50)).toEqual(['vue'])
    expect(
      calls.find((c) => c.url.pathname === '/api/index/facets')
    ).toBeDefined()
    expect(await service.distinctLocales()).toEqual(['en', 'fr'])
    expect(await service.tagCounts()).toEqual({ react: 2 })
    expect(await service.categoryCounts()).toEqual({ guides: 1 })
  })

  it('falls back to the cached rows for facets when the network drops', async () => {
    const { service, failing } = makeHarness({
      routes: {
        '/api/index/query': () => ({
          rows: [serverRow('a', { tags: ['cached'] })],
          total: 1
        })
      }
    })
    await service.query(q()) // primes the cache
    failing.on = true
    expect(await service.distinctTags('', 10)).toEqual(['cached'])
    expect(await service.distinctLocales()).toEqual(['en'])
    expect(await service.tagCounts()).toEqual({ cached: 1 })
  })
})

describe('createHttpIndexService · write-side bookkeeping', () => {
  it('reindexEntry re-derives one entry into the offline cache', async () => {
    const d = draftInput('a', { title: 'Alpha' })
    const { service, index, git } = makeHarness({
      files: [{ path: 'content/post/en/a.mdoc', content: committedOf(d) }],
      drafts: [d]
    })
    expect(await git.headSha()).not.toBeNull()
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    const cached = await index.query(q())
    expect(cached.total).toBe(1)
    expect(cached.rows[0]!.status).toBe('staged')
    expect(cached.rows[0]!.hasDraft).toBe(true)
  })

  it('reindexAfterDeploy posts /api/index/refresh; ensureBuilt and markSyncedAt stay off the network', async () => {
    const { service, calls } = makeHarness({
      routes: { '/api/index/refresh': () => ({ ok: true }) }
    })
    await service.ensureBuilt()
    await service.markSyncedAt('abc')
    expect(calls).toHaveLength(0)
    await service.reindexAfterDeploy()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.pathname).toBe('/api/index/refresh')
    expect(calls[0]!.method).toBe('POST')
  })
})

describe('createHttpIndexService · taxonomy/media reads', () => {
  it('referencedBy merges server usages with local drafts (draft content wins)', async () => {
    const usages: MediaUsage[] = [
      { collection: 'post', locale: 'en', slug: 'a', title: 'Alpha' }
    ]
    const { service } = makeHarness({
      routes: { '/api/index/referenced-by': () => usages },
      drafts: [
        // Draft of `a` no longer references the media → server usage dropped.
        draftInput('a', { title: 'Alpha v2' }),
        // Local-only draft referencing it (via frontmatter) → added.
        draftInput('b', {
          title: 'Bravo',
          featuredImage: '/media/2026/07/cat.jpg'
        })
      ]
    })
    expect(await service.referencedBy('2026/07/cat')).toEqual([
      { collection: 'post', locale: 'en', slug: 'b', title: 'Bravo' }
    ])
  })

  it('entriesByTag/entriesByCategory honor draft additions and removals', async () => {
    const aRef: EntryRef = { collection: 'post', locale: 'en', slug: 'a' }
    const { service } = makeHarness({
      routes: {
        '/api/index/entries-by-tag': () => [aRef],
        '/api/index/entries-by-category': () => [aRef]
      },
      drafts: [
        draftInput('a', { title: 'A', tags: [], categories: [] }), // removed both
        draftInput('b', { title: 'B', tags: ['news'], categories: ['guides'] })
      ]
    })
    expect(await service.entriesByTag('news')).toEqual([
      { collection: 'post', locale: 'en', slug: 'b' }
    ])
    expect(await service.entriesByCategory('guides')).toEqual([
      { collection: 'post', locale: 'en', slug: 'b' }
    ])
  })
})
