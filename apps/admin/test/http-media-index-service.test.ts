import { describe, expect, it } from 'vitest'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import type { MediaIndexQuery, MediaIndexRow, MediaRecord } from '@setu/core'
import { createHttpMediaIndexService } from '../src/data/http-media-index-service'

const row = (
  mediaKey: string,
  over: Partial<MediaIndexRow> = {}
): MediaIndexRow => ({
  mediaKey,
  key: `${mediaKey}.jpg`,
  thumbKey: null,
  filename: `${mediaKey.split('/').pop()}.jpg`,
  filenameLower: `${mediaKey.split('/').pop()}.jpg`,
  contentType: 'image/jpeg',
  isImage: true,
  width: null,
  height: null,
  bytes: 1,
  uploadedAt: 1,
  ...over
})

const rec = (mediaKey: string): MediaRecord => {
  const { filenameLower: _drop, ...r } = row(mediaKey)
  return r
}

function makeHarness(body: () => { rows: MediaIndexRow[]; total: number }) {
  const calls: { url: URL; method: string }[] = []
  const failing = { on: false }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push({ url, method: init?.method ?? 'GET' })
    if (failing.on) throw new TypeError('network down')
    return {
      ok: true,
      status: 200,
      json: async () => body()
    } as unknown as Response
  }) as typeof fetch
  const mediaIndex = createMemoryMediaIndexPort()
  const service = createHttpMediaIndexService({
    apiBase: 'http://api',
    fetchImpl,
    mediaIndex
  })
  return { service, mediaIndex, calls, failing }
}

const q = (over: Partial<MediaIndexQuery> = {}): MediaIndexQuery => ({
  offset: 0,
  limit: 24,
  ...over
})

describe('createHttpMediaIndexService', () => {
  it('serves server rows and falls back to the cached copy when the network drops', async () => {
    const { service, calls, failing } = makeHarness(() => ({
      rows: [row('2026/07/cat')],
      total: 1
    }))
    const first = await service.query(q({ q: 'cat', type: 'image' }))
    expect(first.total).toBe(1)
    expect(first.rows[0]!.mediaKey).toBe('2026/07/cat')
    expect(calls[0]!.url.pathname).toBe('/api/index/media/query')
    expect(calls[0]!.url.searchParams.get('q')).toBe('cat')
    expect(calls[0]!.url.searchParams.get('type')).toBe('image')

    failing.on = true
    const offline = await service.query(q())
    expect(offline.total).toBe(1)
    expect(offline.rows[0]!.mediaKey).toBe('2026/07/cat')
  })

  it('ensureBuilt/refresh stay off the network (the server builds per request)', async () => {
    const { service, calls } = makeHarness(() => ({ rows: [], total: 0 }))
    await service.ensureBuilt()
    await service.refresh()
    expect(calls).toHaveLength(0)
  })

  it('upsertOne/removeOne maintain the offline cache', async () => {
    const { service, failing } = makeHarness(() => ({ rows: [], total: 0 }))
    await service.upsertOne(rec('2026/07/dog'))
    failing.on = true
    expect((await service.query(q())).total).toBe(1)
    await service.removeOne('2026/07/dog')
    expect((await service.query(q())).total).toBe(0)
  })
})
