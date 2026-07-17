import { describe, expect, it } from 'vitest'
import { createMemoryGitPort } from '@setu/git-memory'
import {
  createMemoryDataPort,
  createMemoryIndexPort,
  createMemoryMediaIndexPort
} from '@setu/db-memory'
import { createIndexService, createMediaIndexService } from '@setu/core'
import type {
  Actor,
  ContentRow,
  DeployInfo,
  EntryRef,
  MediaRecord,
  MediaUsage
} from '@setu/core'
import { createIndexApi, latchInFlight } from '../src/index-api'

const admin: Actor = { id: 'a', role: 'admin' }

const mdoc = (
  title: string,
  tags: string[] = [],
  opts: { categories?: string[]; body?: string } = {}
): string =>
  `---\ntitle: ${title}\n${
    tags.length ? `tags:\n${tags.map((t) => `  - ${t}`).join('\n')}\n` : ''
  }${
    opts.categories?.length
      ? `categories:\n${opts.categories.map((c) => `  - ${c}`).join('\n')}\n`
      : ''
  }---\n\n${opts.body ?? `Body of ${title}`}\n`

const rec = (
  mediaKey: string,
  over: Partial<MediaRecord> = {}
): MediaRecord => ({
  mediaKey,
  key: `${mediaKey}.jpg`,
  thumbKey: null,
  filename: `${mediaKey.split('/').pop()}.jpg`,
  contentType: 'image/jpeg',
  isImage: true,
  width: null,
  height: null,
  bytes: 1,
  uploadedAt: 1,
  ...over
})

/** Full wiring over in-memory ports: the same createIndexService /
 *  createMediaIndexService server.ts constructs, driven through the routes. */
function makeHarness(actor: Actor | null = admin) {
  const git = createMemoryGitPort([
    {
      path: 'content/post/en/hello.mdoc',
      content: mdoc('Hello', ['react'], {
        categories: ['guides'],
        body: '![cat](/media/2026/07/cat.jpg)'
      })
    },
    {
      path: 'content/post/en/world.mdoc',
      content: mdoc('World', ['react', 'vue'])
    },
    { path: 'content/page/fr/apropos.mdoc', content: mdoc('About FR') }
  ])
  // Mutable deploy truth so tests can simulate a deploy that does NOT move git
  // HEAD (exactly the case POST /api/index/refresh exists for).
  const deploy: { info: DeployInfo } = {
    info: { deployedSha: null, changed: [] }
  }
  const index = createIndexService({
    data: createMemoryDataPort(),
    git,
    index: createMemoryIndexPort(),
    deploy: () => deploy.info
  })
  const media = createMediaIndexService({
    mediaIndex: createMemoryMediaIndexPort(),
    fetchRaw: async () => [
      rec('2026/07/cat'),
      rec('2026/07/notes', {
        key: '2026/07/notes.pdf',
        filename: 'notes.pdf',
        contentType: 'application/pdf',
        isImage: false
      })
    ]
  })
  const app = createIndexApi({
    resolveActor: () => actor,
    index: { ...index, ensureBuilt: latchInFlight(() => index.ensureBuilt()) },
    media,
    refresh: latchInFlight(() => index.reindexAfterDeploy())
  })
  const get = (path: string) => app.fetch(new Request(`http://x${path}`))
  const post = (path: string) =>
    app.fetch(new Request(`http://x${path}`, { method: 'POST' }))
  return { app, git, get, post, deploy }
}

describe('GET /api/index/query', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect((await get('/api/index/query?collection=post')).status).toBe(401)
  })

  it('401 for an unknown-role session (resolver fails closed to null actor)', async () => {
    // resolveSessionActor maps an unknown role to a null actor; the route sees
    // exactly what this resolver returns.
    const { get } = makeHarness(null)
    expect((await get('/api/index/query?collection=post')).status).toBe(401)
  })

  it('builds the index on demand and returns rows for the collection', async () => {
    const { get } = makeHarness()
    const res = await get('/api/index/query?collection=post')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: ContentRow[]; total: number }
    expect(body.total).toBe(2)
    expect(body.rows.map((r) => r.title).sort()).toEqual(['Hello', 'World'])
    expect(body.rows[0]!.ref.collection).toBe('post')
  })

  it('applies q/tag filters and pagination', async () => {
    const { get } = makeHarness()
    const one = (await (
      await get('/api/index/query?collection=post&q=hello')
    ).json()) as { total: number }
    expect(one.total).toBe(1)
    const tagged = (await (
      await get('/api/index/query?collection=post&tag=vue')
    ).json()) as { rows: ContentRow[]; total: number }
    expect(tagged.total).toBe(1)
    expect(tagged.rows[0]!.title).toBe('World')
    const paged = (await (
      await get('/api/index/query?collection=post&limit=1&sort=title&dir=asc')
    ).json()) as { rows: ContentRow[]; total: number }
    expect(paged.total).toBe(2)
    expect(paged.rows).toHaveLength(1)
    expect(paged.rows[0]!.title).toBe('Hello')
  })

  it('400 on invalid input: missing collection, out-of-range limit, bad sort key', async () => {
    const { get } = makeHarness()
    expect((await get('/api/index/query')).status).toBe(400)
    expect(
      (await get('/api/index/query?collection=post&limit=1000')).status
    ).toBe(400)
    expect((await get('/api/index/query?collection=post&limit=0')).status).toBe(
      400
    )
    expect(
      (await get('/api/index/query?collection=post&sort=evil')).status
    ).toBe(400)
    expect(
      (await get('/api/index/query?collection=post&offset=-1')).status
    ).toBe(400)
  })

  it('reflects an entry committed after the first build (refresh path)', async () => {
    const { get, git } = makeHarness()
    const before = (await (
      await get('/api/index/query?collection=post')
    ).json()) as { total: number }
    expect(before.total).toBe(2)
    await git.commitFile({
      path: 'content/post/en/fresh.mdoc',
      content: mdoc('Fresh'),
      message: 'add fresh',
      author: { name: 'T', email: 't@x.com' }
    })
    const after = (await (
      await get('/api/index/query?collection=post')
    ).json()) as { rows: ContentRow[]; total: number }
    expect(after.total).toBe(3)
    expect(after.rows.map((r) => r.title)).toContain('Fresh')
  })
})

describe('GET /api/index/stats', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect((await get('/api/index/stats')).status).toBe(401)
  })

  it('returns per-collection lifecycle tallies over the built index', async () => {
    const { get } = makeHarness()
    const res = await get('/api/index/stats')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, Record<string, number>>
    // Seeded git: 2 posts (Hello, World) + 1 page (About FR). No deploy →
    // committed-but-undeployed content is 'staged'.
    expect(body['post']).toEqual({
      total: 2,
      draft: 0,
      staged: 2,
      live: 0,
      unpublished: 0
    })
    expect(body['page']).toEqual({
      total: 1,
      draft: 0,
      staged: 1,
      live: 0,
      unpublished: 0
    })
  })
})

describe('GET /api/index/facets', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect((await get('/api/index/facets')).status).toBe(401)
  })

  it('returns tag/locale/category facets', async () => {
    const { get } = makeHarness()
    const res = await get('/api/index/facets')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      distinctTags: string[]
      distinctLocales: string[]
      categoryCounts: Record<string, number>
      tagCounts: Record<string, number>
    }
    expect(body.distinctTags.sort()).toEqual(['react', 'vue'])
    expect(body.distinctLocales).toEqual(['en', 'fr'])
    expect(body.tagCounts).toEqual({ react: 2, vue: 1 })
    expect(body.categoryCounts).toEqual({ guides: 1 })
  })

  it('supports tag prefix type-ahead and rejects an oversized tagLimit', async () => {
    const { get } = makeHarness()
    const body = (await (
      await get('/api/index/facets?tagPrefix=vu&tagLimit=5')
    ).json()) as { distinctTags: string[] }
    expect(body.distinctTags).toEqual(['vue'])
    expect((await get('/api/index/facets?tagLimit=99999')).status).toBe(400)
  })
})

describe('GET /api/index/media/query', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect((await get('/api/index/media/query')).status).toBe(401)
  })

  it('returns media rows with total and filters by kind', async () => {
    const { get } = makeHarness()
    const all = (await (await get('/api/index/media/query')).json()) as {
      rows: { mediaKey: string }[]
      total: number
    }
    expect(all.total).toBe(2)
    const images = (await (
      await get('/api/index/media/query?type=image')
    ).json()) as { rows: { mediaKey: string }[]; total: number }
    expect(images.total).toBe(1)
    expect(images.rows[0]!.mediaKey).toBe('2026/07/cat')
  })

  it('400 on an out-of-range limit', async () => {
    const { get } = makeHarness()
    expect((await get('/api/index/media/query?limit=1000')).status).toBe(400)
  })
})

describe('GET /api/index/referenced-by', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect(
      (await get('/api/index/referenced-by?mediaKey=2026%2F07%2Fcat')).status
    ).toBe(401)
  })

  it('400 when mediaKey is missing', async () => {
    const { get } = makeHarness()
    expect((await get('/api/index/referenced-by')).status).toBe(400)
  })

  it('returns the entries whose live content references the media key', async () => {
    const { get } = makeHarness()
    const res = await get(
      `/api/index/referenced-by?mediaKey=${encodeURIComponent('2026/07/cat')}`
    )
    expect(res.status).toBe(200)
    expect((await res.json()) as MediaUsage[]).toEqual([
      { collection: 'post', locale: 'en', slug: 'hello', title: 'Hello' }
    ])
    const none = await get('/api/index/referenced-by?mediaKey=nope')
    expect((await none.json()) as MediaUsage[]).toEqual([])
  })
})

describe('GET /api/index/entries-by-category', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect(
      (await get('/api/index/entries-by-category?slug=guides')).status
    ).toBe(401)
  })

  it('400 when slug is missing', async () => {
    const { get } = makeHarness()
    expect((await get('/api/index/entries-by-category')).status).toBe(400)
  })

  it('returns refs of entries in the category', async () => {
    const { get } = makeHarness()
    const res = await get('/api/index/entries-by-category?slug=guides')
    expect(res.status).toBe(200)
    expect((await res.json()) as EntryRef[]).toEqual([
      { collection: 'post', locale: 'en', slug: 'hello' }
    ])
  })
})

describe('GET /api/index/entries-by-tag', () => {
  it('401 when unauthenticated', async () => {
    const { get } = makeHarness(null)
    expect((await get('/api/index/entries-by-tag?tag=vue')).status).toBe(401)
  })

  it('400 when tag is missing', async () => {
    const { get } = makeHarness()
    expect((await get('/api/index/entries-by-tag')).status).toBe(400)
  })

  it('returns refs of entries carrying the tag', async () => {
    const { get } = makeHarness()
    const res = await get('/api/index/entries-by-tag?tag=vue')
    expect(res.status).toBe(200)
    expect((await res.json()) as EntryRef[]).toEqual([
      { collection: 'post', locale: 'en', slug: 'world' }
    ])
  })
})

describe('POST /api/index/refresh', () => {
  it('401 when unauthenticated', async () => {
    const { post } = makeHarness(null)
    expect((await post('/api/index/refresh')).status).toBe(401)
  })

  it('re-derives deploy-derived lifecycle after a deploy that did not move HEAD', async () => {
    const { get, post, git, deploy } = makeHarness()
    const statuses = async () => {
      const body = (await (
        await get('/api/index/query?collection=post')
      ).json()) as { rows: ContentRow[] }
      return body.rows.map((r) => r.lifecycle.state).sort()
    }
    // Never deployed → both committed posts are staged.
    expect(await statuses()).toEqual(['staged', 'staged'])
    // A deploy lands at HEAD (no new commit). ensureBuilt alone cannot see it:
    // its sha-compare finds indexedSha === HEAD and skips the rebuild.
    deploy.info = { deployedSha: await git.headSha(), changed: [] }
    expect(await statuses()).toEqual(['staged', 'staged'])
    // The refresh endpoint forces the re-derivation → rows flip to live.
    const res = await post('/api/index/refresh')
    expect(res.status).toBe(200)
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true })
    expect(await statuses()).toEqual(['live', 'live'])
  })
})

describe('latchInFlight', () => {
  it('shares one in-flight promise across concurrent callers, then resets', async () => {
    let runs = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fn = latchInFlight(async () => {
      runs += 1
      await gate
    })
    const a = fn()
    const b = fn()
    expect(runs).toBe(1) // second call latched onto the first
    release()
    await Promise.all([a, b])
    await fn() // after settle, a new call runs again
    expect(runs).toBe(2)
  })

  it('clears the latch after a rejection so the next call retries', async () => {
    let runs = 0
    const fn = latchInFlight(async () => {
      runs += 1
      if (runs === 1) throw new Error('boom')
    })
    await expect(fn()).rejects.toThrow('boom')
    await expect(fn()).resolves.toBeUndefined()
    expect(runs).toBe(2)
  })
})
