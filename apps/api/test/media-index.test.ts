import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(k, b, o) {
      map.set(k, { body: b.slice(), contentType: o.contentType })
    },
    async get(k) {
      const o = map.get(k)
      return o ? { body: o.body.slice(), contentType: o.contentType } : null
    },
    async delete(k) {
      map.delete(k)
    },
    async exists(k) {
      return map.has(k)
    },
    url(k) {
      return `http://test/media/${k}`
    },
    async list(prefix?: string) {
      const ks = [...map.keys()]
      return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks
    }
  }
}
const owner: Actor = { id: 'local', role: 'owner' }

async function upload(app: ReturnType<typeof createUploadApi>, file: File) {
  const body = new FormData()
  body.append('file', file)
  return app.fetch(new Request('http://test/media', { method: 'POST', body }))
}

describe('GET /media/_index', () => {
  it('returns a record per uploaded item (image + non-image)', async () => {
    const storage = memStorage()
    const app = createUploadApi({ storage, resolveActor: () => owner })
    await upload(
      app,
      new File([new Uint8Array([1])], 'Cat Photo.png', { type: 'image/png' })
    )
    await upload(
      app,
      new File([new Uint8Array([2, 3])], 'notes.pdf', {
        type: 'application/pdf'
      })
    )
    const res = await app.fetch(new Request('http://test/media/_index'))
    expect(res.status).toBe(200)
    const { records } = (await res.json()) as {
      records: { filename: string; isImage: boolean; bytes: number }[]
    }
    expect(records).toHaveLength(2)
    const pdf = records.find((r) => r.filename === 'notes.pdf')!
    expect(pdf.isImage).toBe(false)
    expect(pdf.bytes).toBe(2)
  })
})
