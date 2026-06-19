import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

/** Inline in-memory StoragePort fake (value-semantics: copies bytes both ways). */
function memStorage(): StoragePort & { map: Map<string, StoredObject> } {
  const map = new Map<string, StoredObject>()
  return {
    map,
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `http://test/uploads/${key}` },
  }
}

const owner: Actor = { id: 'local', role: 'owner' }
const viewer: Actor = { id: 'v', role: 'viewer' }

function makeApp(resolve: () => Actor | null, opts?: { maxBytes?: number; storage?: ReturnType<typeof memStorage> }) {
  const storage = opts?.storage ?? memStorage()
  const app = createUploadApi({
    storage,
    resolveActor: resolve,
    limits: opts?.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : undefined,
  })
  return { app, storage }
}

function post(app: ReturnType<typeof createUploadApi>, file?: File) {
  const body = new FormData()
  if (file) body.append('file', file)
  return app.fetch(new Request('http://test/media', { method: 'POST', body }))
}

const png = (bytes = 4, name = 'a.png', type = 'image/png') =>
  new File([new Uint8Array(bytes).fill(7)], name, { type })

describe('POST /media', () => {
  it('stores the file and returns a loadable url (201)', async () => {
    const { app, storage } = makeApp(() => owner)
    const res = await post(app, png(4))
    expect(res.status).toBe(201)
    const json = (await res.json()) as { key: string; url: string; contentType: string; size: number; filename: string }
    expect(json.key).toMatch(/^media\/[0-9a-f-]{36}\/original\.png$/)
    expect(json.url).toBe(`http://test/uploads/${json.key}`)
    expect(json.contentType).toBe('image/png')
    expect(json.size).toBe(4)
    expect(json.filename).toBe('a.png')
    const stored = await storage.get(json.key)
    expect(stored?.contentType).toBe('image/png')
    expect(stored?.body.length).toBe(4)
  })

  it('derives the extension from the content-type, not the filename', async () => {
    const { app } = makeApp(() => owner)
    const res = await post(app, png(2, 'weird-name.bin', 'application/pdf'))
    const json = (await res.json()) as { key: string }
    expect(json.key).toMatch(/\/original\.pdf$/)
  })

  it('401 when unauthenticated', async () => {
    const { app } = makeApp(() => null)
    expect((await post(app, png())).status).toBe(401)
  })

  it('403 when the actor lacks content.create', async () => {
    const { app } = makeApp(() => viewer)
    const res = await post(app, png())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('400 when no file field is present', async () => {
    const { app } = makeApp(() => owner)
    const res = await post(app)
    expect(res.status).toBe(400)
  })

  it('413 when the file exceeds maxBytes', async () => {
    const { app } = makeApp(() => owner, { maxBytes: 3 })
    const res = await post(app, png(10))
    expect(res.status).toBe(413)
  })

  it('415 when the content-type is not allowed', async () => {
    const { app } = makeApp(() => owner)
    expect((await post(app, png(4, 'x.svg', 'image/svg+xml'))).status).toBe(415)
    expect((await post(app, png(4, 'x.html', 'text/html'))).status).toBe(415)
  })

  it('415 when a custom allowedContentTypes includes a type with no extension mapping', async () => {
    const app = createUploadApi({
      storage: memStorage(),
      resolveActor: () => owner,
      limits: { allowedContentTypes: new Set(['application/x-custom']) },
    })
    const file = new File([new Uint8Array(4).fill(1)], 'data.bin', { type: 'application/x-custom' })
    const body = new FormData()
    body.append('file', file)
    const res = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(res.status).toBe(415)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('application/x-custom')
  })
})
