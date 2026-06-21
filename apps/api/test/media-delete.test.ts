import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(k, b, o) { map.set(k, { body: b.slice(), contentType: o.contentType }) },
    async get(k) { const o = map.get(k); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(k) { map.delete(k) },
    async exists(k) { return map.has(k) },
    url(k) { return `http://test/media/${k}` },
    async list(prefix?: string) { const ks = [...map.keys()]; return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks },
  }
}
const owner: Actor = { id: 'local', role: 'owner' }

async function upload(app: ReturnType<typeof createUploadApi>, file: File) {
  const body = new FormData(); body.append('file', file)
  return app.fetch(new Request('http://test/media', { method: 'POST', body }))
}

describe('DELETE /media/*', () => {
  it('removes the original and its media-record sidecar', async () => {
    const storage = memStorage()
    const app = createUploadApi({ storage, resolveActor: () => owner })

    // Upload a non-image (no manifest/variants produced)
    const upRes = await upload(app, new File([new Uint8Array([10, 20, 30])], 'a.pdf', { type: 'application/pdf' }))
    expect(upRes.status).toBe(201)
    const { id, key } = (await upRes.json()) as { id: string; key: string }

    // Verify both files exist before deletion
    expect(await storage.exists(key)).toBe(true)
    expect(await storage.exists(`${id}.media.json`)).toBe(true)

    // Delete by mediaKey (id)
    const delRes = await app.fetch(
      new Request(`http://test/media/${id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer local' },
      }),
    )
    expect(delRes.status).toBe(200)
    expect(await delRes.json()).toEqual({ ok: true })

    // Both original file and media record sidecar must be gone
    expect(await storage.exists(key)).toBe(false)
    expect(await storage.exists(`${id}.media.json`)).toBe(false)
  })

  it('returns 403 when actor lacks content.create', async () => {
    const viewer: Actor = { id: 'v', role: 'viewer' }
    const storage = memStorage()
    // Upload with owner
    const ownerApp = createUploadApi({ storage, resolveActor: () => owner })
    const upRes = await upload(ownerApp, new File([new Uint8Array([1])], 'b.pdf', { type: 'application/pdf' }))
    const { id } = (await upRes.json()) as { id: string }

    // Try delete with viewer
    const viewerApp = createUploadApi({ storage, resolveActor: () => viewer })
    const delRes = await viewerApp.fetch(
      new Request(`http://test/media/${id}`, { method: 'DELETE' }),
    )
    expect(delRes.status).toBe(403)
  })
})
