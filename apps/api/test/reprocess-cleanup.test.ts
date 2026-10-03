// #1160: Reprocess must not orphan the previous variants (DELETE only removes what the CURRENT
// manifest lists, so an orphan stays publicly served forever) and must rewrite the library record.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaManifest, MediaRecord, StoragePort } from '@setu/core'
import { manifestKey, mediaRecordKey } from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'
import { reprocessOne } from '../src/reprocess-runner'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const image = createSharpImageAdapter()

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'reprocess-cleanup-'))
  dirs.push(dir)
  const storage = createLocalStorage({
    dir,
    baseUrl: 'http://localhost:4444/media'
  })
  const app = createUploadApi({
    storage,
    resolveActor: () => ({ id: 'o', role: 'admin' }),
    image,
    widths: [400, 800],
    mediaSettings: { imageFormat: 'webp', imageLqip: false }
  })
  return { app, storage }
}

const readJson = async <T>(storage: StoragePort, key: string) =>
  JSON.parse(new TextDecoder().decode((await storage.get(key))!.body)) as T

const status = async (app: ReturnType<typeof createUploadApi>, key: string) =>
  (await app.fetch(new Request(`http://test/media/${key}`))).status

describe('reprocessOne cleans up the previous variants (#1160)', () => {
  it(
    'webp → avif: old variants are deleted, the record is rewritten, and DELETE leaves nothing served',
    { timeout: 30_000 },
    async () => {
      const { app, storage } = fresh()
      const body = new FormData()
      body.append(
        'file',
        new File([makeTestPng(1000, 600)], 'pic.png', { type: 'image/png' })
      )
      const up = (await (
        await app.fetch(
          new Request('http://test/media', { method: 'POST', body })
        )
      ).json()) as { id: string; key: string; manifest: MediaManifest }
      const oldKeys = up.manifest.variants.map((v) => v.key)
      expect(oldKeys.length).toBeGreaterThan(0)

      const upserts: MediaRecord[] = []
      const result = await reprocessOne(
        {
          image,
          storage,
          media: { imageFormat: 'avif', imageLqip: false },
          widths: [300, 600],
          mediaIndex: {
            upsertOne: async (r) => {
              upserts.push(r)
            }
          }
        },
        manifestKey(up.id)
      )
      expect(result).toBe('done')

      const man = await readJson<MediaManifest>(storage, manifestKey(up.id))
      const newKeys = man.variants.map((v) => v.key)
      expect(new Set(man.variants.map((v) => v.format))).toEqual(
        new Set(['avif'])
      )
      for (const k of oldKeys) expect(await status(app, k)).toBe(404)
      for (const k of newKeys) expect(await status(app, k)).toBe(200)

      const rec = await readJson<MediaRecord>(storage, mediaRecordKey(up.id))
      const smallest = [...man.variants].sort((a, b) => a.width - b.width)[0]!
      expect(rec.thumbKey).toBe(smallest.key)
      expect(rec.width).toBe(1000)
      expect(rec.height).toBe(600)
      expect(rec.filename).toBe('pic.png') // the rest of the record is preserved
      expect(upserts).toEqual([rec])

      const del = await app.fetch(
        new Request(`http://test/media/${up.id}`, { method: 'DELETE' })
      )
      expect(del.status).toBe(200)
      for (const k of [...oldKeys, ...newKeys, up.key])
        expect(await status(app, k)).toBe(404)
      expect(await storage.list()).toEqual([])
    }
  )

  it(
    'a legacy variant key that is now another upload’s original is never deleted',
    { timeout: 30_000 },
    async () => {
      const { app, storage } = fresh()
      // Two uploads in the damaged layout pre-#1159 storage could reach: `cat`'s manifest lists
      // `cat-400w.webp`, which is also the original of the separate upload `cat-400w`.
      const body = new FormData()
      body.append(
        'file',
        new File([makeTestPng(1000, 600)], 'cat.png', { type: 'image/png' })
      )
      const cat = (await (
        await app.fetch(
          new Request('http://test/media', { method: 'POST', body })
        )
      ).json()) as { id: string; manifest: MediaManifest }
      const other = `${cat.id}-400w`
      const otherBytes = new Uint8Array([7, 7, 7])
      await storage.put(`${other}.webp`, otherBytes, {
        contentType: 'image/webp'
      })
      await storage.put(
        mediaRecordKey(other),
        new TextEncoder().encode(
          JSON.stringify({ mediaKey: other, key: `${other}.webp` })
        ),
        { contentType: 'application/json' }
      )
      const legacy: MediaManifest = {
        ...cat.manifest,
        variants: [{ ...cat.manifest.variants[0]!, key: `${other}.webp` }]
      }
      await storage.put(
        manifestKey(cat.id),
        new TextEncoder().encode(JSON.stringify(legacy)),
        { contentType: 'application/json' }
      )

      await reprocessOne(
        {
          image,
          storage,
          media: { imageFormat: 'avif', imageLqip: false },
          widths: [400]
        },
        manifestKey(cat.id)
      )
      expect((await storage.get(`${other}.webp`))?.body).toEqual(otherBytes)

      // …and DELETE of `cat` must not take it either, even straight from the damaged manifest.
      await storage.put(
        manifestKey(cat.id),
        new TextEncoder().encode(JSON.stringify(legacy)),
        { contentType: 'application/json' }
      )
      await app.fetch(
        new Request(`http://test/media/${cat.id}`, { method: 'DELETE' })
      )
      expect((await storage.get(`${other}.webp`))?.body).toEqual(otherBytes)
    }
  )
})
