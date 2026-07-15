import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { createUploadApi, listMediaRecords } from '../src/media'

/** Upload-time freshness for the server media index (#464 Increment B).
 *
 *  The server media index only rebuilds on a version mismatch (cheap boot
 *  behavior), so an upload after the first build would stay invisible to
 *  GET /api/index/media/query until a restart. The upload route therefore
 *  upserts the freshly written record into the media index in-process, and
 *  the delete route removes it. These tests prove exactly that seam: the
 *  index is built BEFORE the mutation, and queried WITHOUT a rebuild after. */

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) {
      map.set(key, { body: body.slice(), contentType: opts.contentType })
    },
    async get(key) {
      const o = map.get(key)
      return o ? { body: o.body.slice(), contentType: o.contentType } : null
    },
    async delete(key) {
      map.delete(key)
    },
    async exists(key) {
      return map.has(key)
    },
    url(key) {
      return `http://test/media/${key}`
    },
    async list(prefix?: string): Promise<string[]> {
      const keys = [...map.keys()]
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
    }
  }
}

const owner: Actor = { id: 'local', role: 'admin' }

function makeHarness(resolve: () => Actor | null = () => owner) {
  const storage = memStorage()
  const mediaIndex = createMediaIndexService({
    mediaIndex: createMemoryMediaIndexPort(),
    fetchRaw: () => listMediaRecords(storage)
  })
  const app = createUploadApi({ storage, resolveActor: resolve, mediaIndex })
  const upload = (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return app.fetch(new Request('http://test/media', { method: 'POST', body }))
  }
  const del = (mediaKey: string) =>
    app.fetch(
      new Request(`http://test/media/${mediaKey}`, { method: 'DELETE' })
    )
  const queryAll = async () =>
    mediaIndex.query({ offset: 0, limit: 50 }) // no rebuild — index as-is
  return { app, storage, mediaIndex, upload, del, queryAll }
}

const png = (name = 'cat.png') =>
  new File([new Uint8Array(4).fill(7)], name, { type: 'image/png' })

describe('media index upload/delete freshness', () => {
  it('an upload after the initial build is visible without a rebuild', async () => {
    const { mediaIndex, upload, queryAll } = makeHarness()
    await mediaIndex.ensureBuilt() // initial build (empty storage)
    expect((await queryAll()).total).toBe(0)
    const res = await upload(png('Cat.png'))
    expect(res.status).toBe(201)
    const after = await queryAll()
    expect(after.total).toBe(1)
    expect(after.rows[0]!.filename).toBe('Cat.png')
  })

  it('a delete after the initial build removes the row without a rebuild', async () => {
    const { mediaIndex, upload, del, queryAll } = makeHarness()
    const res = await upload(png('Cat.png'))
    const { id } = (await res.json()) as { id: string }
    await mediaIndex.ensureBuilt()
    expect((await queryAll()).total).toBe(1)
    expect((await del(id)).status).toBe(200)
    expect((await queryAll()).total).toBe(0)
  })

  it('401 upload leaves the index untouched', async () => {
    const { mediaIndex, upload, queryAll } = makeHarness(() => null)
    await mediaIndex.ensureBuilt()
    expect((await upload(png())).status).toBe(401)
    expect((await queryAll()).total).toBe(0)
  })
})
