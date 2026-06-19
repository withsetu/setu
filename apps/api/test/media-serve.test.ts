import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `http://test/uploads/${key}` },
  }
}
const owner: Actor = { id: 'local', role: 'owner' }

async function uploadThenServe(file: File) {
  const storage = memStorage()
  const app = createUploadApi({ storage, resolveActor: () => owner })
  const body = new FormData(); body.append('file', file)
  const up = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
  const { key } = await up.json()
  const res = await app.fetch(new Request(`http://test/uploads/${key}`))
  return { res, key }
}

describe('GET /uploads/*', () => {
  it('serves an image inline with its content-type and exact bytes', async () => {
    const { res } = await uploadThenServe(new File([new Uint8Array([1, 2, 3, 4])], 'a.png', { type: 'image/png' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('serves a non-image as an attachment', async () => {
    const { res } = await uploadThenServe(new File([new Uint8Array([5, 6])], 'a.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([5, 6]))
  })

  it('404 for a key outside the media/ namespace', async () => {
    const storage = memStorage()
    const app = createUploadApi({ storage, resolveActor: () => owner })
    // Path traversal attempt: /uploads/..%2F..%2Fetc%2Fpasswd decodes to ../../etc/passwd
    const res = await app.fetch(new Request('http://test/uploads/..%2F..%2Fetc%2Fpasswd'))
    expect(res.status).toBe(404)
  })

  it('404 for an absent key', async () => {
    const storage = memStorage()
    const app = createUploadApi({ storage, resolveActor: () => owner })
    const res = await app.fetch(new Request('http://test/uploads/media/nope/original.png'))
    expect(res.status).toBe(404)
  })
})
