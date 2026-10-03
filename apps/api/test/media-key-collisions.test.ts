// #1159: an upload must never overwrite an object another upload owns — not its original, not
// its `.media.json` library record — and concurrent uploads of one name must get distinct ids.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, MediaRecord, StoragePort } from '@setu/core'
import { manifestKey, mediaRecordKey } from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'

const owner: Actor = { id: 'local', role: 'admin' }

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

function freshApp(withImage = true) {
  const dir = mkdtempSync(join(tmpdir(), 'media-collide-'))
  dirs.push(dir)
  const storage = createLocalStorage({
    dir,
    baseUrl: 'http://localhost:4444/media'
  })
  const app = createUploadApi({
    storage,
    resolveActor: () => owner,
    ...(withImage ? { image: createSharpImageAdapter() } : {}),
    widths: [400, 800],
    mediaSettings: { imageFormat: 'webp', imageLqip: false }
  })
  return { app, storage }
}

type App = ReturnType<typeof createUploadApi>

async function upload(app: App, file: File) {
  const body = new FormData()
  body.append('file', file)
  const res = await app.fetch(
    new Request('http://test/media', { method: 'POST', body })
  )
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; key: string; record: MediaRecord }
}

async function getBytes(app: App, key: string) {
  const res = await app.fetch(new Request(`http://test/media/${key}`))
  return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null
}

async function libraryIds(app: App) {
  const res = await app.fetch(new Request('http://test/media/_index'))
  const { records } = (await res.json()) as { records: MediaRecord[] }
  return records.map((r) => r.mediaKey).sort()
}

describe('upload ids never reuse another upload’s keys (#1159)', () => {
  it(
    'an image whose variants share a name with an existing original leaves that original untouched',
    { timeout: 30_000 },
    async () => {
      const { app } = freshApp()
      // An existing original at `<yyyy>/<mm>/cat-400w.webp`. Its bytes are not a decodable image,
      // so ingest fails (warn-only) and the stored original is exactly these bytes.
      const sentinel = new Uint8Array([0x53, 0x45, 0x54, 0x55, 1, 2, 3, 4])
      const first = await upload(
        app,
        new File([sentinel], 'cat-400w.webp', { type: 'image/webp' })
      )
      expect(first.key).toBe(`${first.id}.webp`)

      // `cat.png` (1000px) generates a 400w webp variant. Under the pre-#1159 naming that was
      // `<id>-400w.webp` — the first upload's original key.
      const second = await upload(
        app,
        new File([makeTestPng(1000, 600)], 'cat.png', { type: 'image/png' })
      )
      expect(second.id).not.toBe(first.id)
      expect(await getBytes(app, first.key)).toEqual(sentinel)

      // Deleting the second upload must not take the first one's file with it.
      const del = await app.fetch(
        new Request(`http://test/media/${second.id}`, { method: 'DELETE' })
      )
      expect(del.status).toBe(200)
      expect(await getBytes(app, first.key)).toEqual(sentinel)
      expect(await libraryIds(app)).toEqual([first.id])
    }
  )

  it('an upload never takes a legacy (`-<w>w`) variant key as its original', async () => {
    const { app, storage } = freshApp(false)
    // Media stored before #1159: id `cat` with a legacy variant at `cat-400w.webp`.
    const legacy = new Uint8Array([9, 9, 9])
    const now = new Date()
    const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    await plantLegacy(storage, `${ym}/cat`, legacy)

    const up = await upload(
      app,
      new File([new Uint8Array([1])], 'cat-400w.webp', { type: 'image/webp' })
    )
    expect(up.id).toBe(`${ym}/cat-400w-2`)
    expect(await getBytes(app, `${ym}/cat-400w.webp`)).toEqual(legacy)
  })

  it('same basename, different non-image types → two ids and two library records', async () => {
    const { app } = freshApp()
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const pdf = await upload(
      app,
      new File([pdfBytes], 'Report.pdf', { type: 'application/pdf' })
    )
    const docx = await upload(
      app,
      new File([docxBytes], 'Report.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })
    )
    expect(docx.id).not.toBe(pdf.id)
    expect(await libraryIds(app)).toEqual([pdf.id, docx.id].sort())
    expect(await getBytes(app, pdf.key)).toEqual(pdfBytes)
    expect(await getBytes(app, docx.key)).toEqual(docxBytes)
  })

  it('concurrent uploads of the same name get distinct ids (no exists-then-put race)', async () => {
    const { app } = freshApp(false)
    const files = [1, 2, 3, 4].map(
      (n) =>
        new File([new Uint8Array([n])], 'Same.pdf', { type: 'application/pdf' })
    )
    const ups = await Promise.all(files.map((f) => upload(app, f)))
    const ids = ups.map((u) => u.id)
    expect(new Set(ids).size).toBe(4)
    expect(await libraryIds(app)).toEqual([...ids].sort())
    for (const [i, u] of ups.entries())
      expect(await getBytes(app, u.key)).toEqual(new Uint8Array([i + 1]))
  })
})

async function plantLegacy(
  storage: StoragePort,
  id: string,
  variant: Uint8Array
) {
  const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
  await storage.put(`${id}.png`, new Uint8Array([0]), {
    contentType: 'image/png'
  })
  await storage.put(`${id}-400w.webp`, variant, { contentType: 'image/webp' })
  await storage.put(
    manifestKey(id),
    json({
      id,
      format: 'webp',
      original: { key: `${id}.png`, width: 800, height: 600, format: 'png' },
      variants: [
        {
          width: 400,
          height: 300,
          key: `${id}-400w.webp`,
          contentType: 'image/webp',
          format: 'webp'
        }
      ]
    }),
    { contentType: 'application/json' }
  )
  await storage.put(
    mediaRecordKey(id),
    json({ mediaKey: id, key: `${id}.png`, thumbKey: `${id}-400w.webp` }),
    { contentType: 'application/json' }
  )
}
