import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Actor,
  MediaManifest,
  StoragePort,
  StoredObject
} from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'

/** Inline in-memory StoragePort fake (value-semantics: copies bytes both ways). */
function memStorage(): StoragePort & { map: Map<string, StoredObject> } {
  const map = new Map<string, StoredObject>()
  return {
    map,
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

function makeApp(
  resolve: () => Actor | null,
  opts?: { maxBytes?: number; storage?: ReturnType<typeof memStorage> }
) {
  const storage = opts?.storage ?? memStorage()
  const app = createUploadApi({
    storage,
    resolveActor: resolve,
    limits:
      opts?.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : undefined
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
    const res = await post(app, png(4, 'Cat.png'))
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      id: string
      key: string
      url: string
      contentType: string
      size: number
      filename: string
    }
    // id = YYYY/MM/slug (year/month are "now")
    expect(json.id).toMatch(/^\d{4}\/\d{2}\/cat$/)
    expect(json.key).toBe(`${json.id}.png`)
    expect(json.url).toBe(`http://test/media/${json.key}`)
    expect(json.contentType).toBe('image/png')
    expect(json.size).toBe(4)
    expect(json.filename).toBe('Cat.png')
    const stored = await storage.get(json.key)
    expect(stored?.contentType).toBe('image/png')
    expect(stored?.body.length).toBe(4)
  })

  it('derives the extension from the content-type, not the filename', async () => {
    const { app } = makeApp(() => owner)
    const res = await post(app, png(2, 'weird-name.bin', 'application/pdf'))
    const json = (await res.json()) as { key: string }
    expect(json.key).toMatch(/^\d{4}\/\d{2}\/.+\.pdf$/)
  })

  it('second upload of same filename gets a -2 suffix (collision dedup)', async () => {
    const storage = memStorage()
    const { app } = makeApp(() => owner, { storage })
    // First upload
    const res1 = await post(app, png(4, 'Cat.png'))
    const json1 = (await res1.json()) as { id: string; key: string }
    expect(json1.id).toMatch(/^\d{4}\/\d{2}\/cat$/)
    // Second upload of same filename — must deduplicate
    const res2 = await post(app, png(4, 'Cat.png'))
    const json2 = (await res2.json()) as { id: string; key: string }
    expect(json2.id).toMatch(/^\d{4}\/\d{2}\/cat-2$/)
    expect(json2.key).toBe(`${json2.id}.png`)
  })

  it('cross-content-type collision: PNG then JPEG with same basename get distinct ids', async () => {
    const storage = memStorage()
    const { app } = makeApp(() => owner, { storage })
    // Upload Cat.png — creates 2026/06/cat.png (original) and 2026/06/cat.manifest.json
    // Simulate a manifest entry so the manifest key is occupied (like a real ingest would do)
    // For the bug test, we just upload then upload again with a different extension
    const res1 = await post(app, png(4, 'Cat.png', 'image/png'))
    expect(res1.status).toBe(201)
    const json1 = (await res1.json()) as { id: string; key: string }
    expect(json1.id).toMatch(/^\d{4}\/\d{2}\/cat$/)
    expect(json1.key).toMatch(/\.png$/)

    // Manually put a manifest at the cat mediaKey to simulate what ingestImage would do
    // (the upload handler skips ingest here since no ImagePort is configured, but the
    // collision probe must still detect ext-independent conflicts via the manifest key)
    const [yyyy, mm, slug] = json1.id.split('/')
    const fakeManifestKey = `${yyyy}/${mm}/${slug}.manifest.json`
    await storage.put(fakeManifestKey, new TextEncoder().encode('{}'), {
      contentType: 'application/json'
    })

    // Upload Cat.jpeg (same basename, different ext) — without the fix this would get id=2026/06/cat
    // because the probe only checks 2026/06/cat.jpg (not present), colliding with the first's manifest
    const res2 = await post(app, png(4, 'Cat.jpeg', 'image/jpeg'))
    expect(res2.status).toBe(201)
    const json2 = (await res2.json()) as { id: string; key: string }
    // Must have a distinct id — the manifest key probe forces dedup
    expect(json2.id).toMatch(/^\d{4}\/\d{2}\/cat-2$/)
    expect(json2.key).toMatch(/\.jpg$/)
    expect(json2.id).not.toBe(json1.id)
  })

  it('401 when unauthenticated', async () => {
    // #379: upload is gated on media.upload, which every current staff role holds — so the only
    // deny path left is the unauthenticated one (no actor → 401). The old Viewer 403 case is gone.
    const { app } = makeApp(() => null)
    expect((await post(app, png())).status).toBe(401)
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
      limits: { allowedContentTypes: new Set(['application/x-custom']) }
    })
    const file = new File([new Uint8Array(4).fill(1)], 'data.bin', {
      type: 'application/x-custom'
    })
    const body = new FormData()
    body.append('file', file)
    const res = await app.fetch(
      new Request('http://test/media', { method: 'POST', body })
    )
    expect(res.status).toBe(415)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('application/x-custom')
  })
})

// ── Media settings integration ────────────────────────────────────────────────

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('POST /media — media settings (both formats + lqip)', () => {
  it('generates both formats + lqip when media settings say so', { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upload-settings-'))
    tmpDirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const app = createUploadApi({
      storage,
      resolveActor: () => ({ id: 'local', role: 'admin' }),
      image: createSharpImageAdapter(),
      mediaSettings: { imageFormat: 'both', imageLqip: true }
    })

    const body = new FormData()
    body.append(
      'file',
      new File([makeTestPng(400, 300)], 'pic.png', { type: 'image/png' })
    )
    const res = await app.fetch(
      new Request('http://test/media', { method: 'POST', body })
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { manifest?: MediaManifest }
    expect(json.manifest).toBeTruthy()
    const formats = new Set(json.manifest!.variants.map((v) => v.format))
    expect(formats).toEqual(new Set(['webp', 'avif']))
    expect(json.manifest!.lqip).toMatch(/^data:image\/webp;base64,/)
  })
})
