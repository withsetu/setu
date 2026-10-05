import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, MediaRecord } from '@setu/core'
import { manifestKey, mediaRecordKey } from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createSqliteReprocessJobStore } from '@setu/db-sqlite'
import { createUploadApi, INGEST_FAILED_REASON } from '../src/media'
import { runReprocessJob } from '../src/reprocess-runner'

// #1161: a failed image ingest used to be a console.warn — the upload answered 201 as a normal
// image with no dimensions and no manifest, and Reprocess enumerated manifests only, so the item
// was unrecoverable. These pin the explicit flag and the Reprocess recovery path.

const owner: Actor = { id: 'local', role: 'admin' }
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const CORRUPT = new TextEncoder().encode('definitely not a png')

function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-fail-'))
  dirs.push(dir)
  const storage = createLocalStorage({
    dir,
    baseUrl: 'http://localhost:4444/media'
  })
  const image = createSharpImageAdapter()
  const store = createSqliteReprocessJobStore(':memory:')
  let runner: Promise<void> = Promise.resolve()
  const app = createUploadApi({
    storage,
    resolveActor: () => owner,
    image,
    mediaSettings: { imageFormat: 'webp', imageLqip: false },
    reprocess: {
      store,
      run: (jobId) => {
        runner = runReprocessJob(
          store,
          {
            image,
            storage,
            media: { imageFormat: 'webp', imageLqip: false },
            widths: [400]
          },
          jobId
        )
      }
    }
  })
  const upload = async (bytes: Uint8Array, name: string, type: string) => {
    const body = new FormData()
    body.append('file', new File([bytes], name, { type }))
    const res = await app.fetch(
      new Request('http://test/media', { method: 'POST', body })
    )
    return {
      status: res.status,
      body: (await res.json()) as {
        id: string
        record: MediaRecord
        ingestFailed: boolean
        ingestError?: string
        manifest?: unknown
      }
    }
  }
  const reprocess = async () => {
    const res = await app.fetch(
      new Request('http://test/api/media/reprocess', { method: 'POST' })
    )
    const started = (await res.json()) as { total: number }
    await runner
    const st = await app.fetch(
      new Request('http://test/api/media/reprocess/status')
    )
    return {
      started,
      status: (await st.json()) as {
        status: string
        processed: number
        total: number
        error?: string
      }
    }
  }
  const record = async (id: string): Promise<MediaRecord> =>
    JSON.parse(
      new TextDecoder().decode((await storage.get(mediaRecordKey(id)))!.body)
    ) as MediaRecord
  return { storage, upload, reprocess, record }
}

describe('upload — a failed ingest is reported, not swallowed (#1161)', () => {
  it('answers 201 with ingestFailed and a fixed, path-free reason', async () => {
    const r = rig()
    const res = await r.upload(CORRUPT, 'broken.png', 'image/png')
    expect(res.status).toBe(201)
    expect(res.body.ingestFailed).toBe(true)
    expect(res.body.ingestError).toBe(INGEST_FAILED_REASON)
    expect(res.body.manifest).toBeUndefined()
    expect(res.body.record.width).toBeNull()
  })
  it('a successful image ingest says ingestFailed: false', async () => {
    const r = rig()
    const res = await r.upload(makeTestPng(500, 300), 'ok.png', 'image/png')
    expect(res.body.ingestFailed).toBe(false)
    expect(res.body.ingestError).toBeUndefined()
    expect(res.body.manifest).toBeDefined()
  })
  it('a non-image upload is not an ingest failure', async () => {
    const r = rig()
    const res = await r.upload(
      new TextEncoder().encode('hello'),
      'notes.txt',
      'text/plain'
    )
    expect(res.body.ingestFailed).toBe(false)
  })
})

describe('Reprocess — image records with no manifest are recoverable (#1161)', () => {
  it('enumerates a manifest-less image record and generates its variants once the original is fixed', async () => {
    const r = rig()
    const { body } = await r.upload(CORRUPT, 'broken.png', 'image/png')
    // The operator fixes the file in place (e.g. restores it from a backup).
    await r.storage.put(body.record.key, makeTestPng(500, 300), {
      contentType: 'image/png'
    })
    const { started, status } = await r.reprocess()
    expect(started.total).toBe(1)
    expect(status.status).toBe('done')
    expect(status.processed).toBe(1)
    expect(status.error).toBeUndefined()
    expect(await r.storage.exists(manifestKey(body.id))).toBe(true)
    const rec = await r.record(body.id)
    expect(rec.width).toBe(500)
    expect(rec.height).toBe(300)
    expect(rec.thumbKey).not.toBeNull()
    expect(rec.filename).toBe('broken.png')
  })

  it('a still-broken image is named in the result and does not stop the rest of the library', async () => {
    const r = rig()
    await r.upload(CORRUPT, 'broken.png', 'image/png')
    const good = await r.upload(makeTestPng(500, 300), 'good.png', 'image/png')
    const { started, status } = await r.reprocess()
    expect(started.total).toBe(2)
    expect(status.status).toBe('done')
    expect(status.processed).toBe(1)
    expect(status.error).toMatch(/broken\.png/)
    expect(status.error).not.toMatch(/good\.png/)
    expect(await r.storage.exists(manifestKey(good.body.id))).toBe(true)
  })

  it('does not enumerate records of types it cannot generate variants for', async () => {
    const r = rig()
    await r.upload(
      new TextEncoder().encode('%PDF-1.4'),
      'doc.pdf',
      'application/pdf'
    )
    await r.upload(new TextEncoder().encode('GIF89a'), 'anim.gif', 'image/gif')
    const { started } = await r.reprocess()
    expect(started.total).toBe(0)
  })

  it('an image with both a manifest and a record is processed once, not twice', async () => {
    const r = rig()
    await r.upload(makeTestPng(500, 300), 'good.png', 'image/png')
    const { started, status } = await r.reprocess()
    expect(started.total).toBe(1)
    expect(status.processed).toBe(1)
  })
})
