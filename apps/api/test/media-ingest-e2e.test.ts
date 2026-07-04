import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'

const dirs: string[] = []
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0 })

function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-'))
  dirs.push(dir)
  const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
  const app = createUploadApi({
    storage,
    resolveActor: () => ({ id: 'local', role: 'admin' }),
    image: createSharpImageAdapter(),
    mediaSettings: { imageFormat: 'webp', imageLqip: false },
  })
  return { app, dir }
}

interface Resp { id: string; manifest?: { variants: { width: number; key: string }[] } }

describe('media ingest e2e (real sharp + storage-local)', () => {
  it('generates a webp ladder + manifest for an uploaded PNG', async () => {
    const { app, dir } = freshApp()
    const body = new FormData()
    body.append('file', new File([makeTestPng(1000, 600)], 'pic.png', { type: 'image/png' }))
    const res = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(res.status).toBe(201)
    const json = (await res.json()) as Resp
    // id = YYYY/MM/pic (human-readable key, no uuid)
    expect(json.id).toMatch(/^\d{4}\/\d{2}\/pic$/)
    expect(json.manifest).toBeTruthy()
    // 1200 & 1600 exceed the 1000px source → dropped; source 1000 added ⇒ [400, 800, 1000]
    expect(json.manifest!.variants.map((v) => v.width)).toEqual([400, 800, 1000])
    // variant key: <id>-<width>w.webp  (e.g. 2026/06/pic-400w.webp)
    expect(existsSync(join(dir, `${json.id}-400w.webp`))).toBe(true)
    // manifest key: <id>.manifest.json  (e.g. 2026/06/pic.manifest.json)
    expect(existsSync(join(dir, `${json.id}.manifest.json`))).toBe(true)
  })

  it('stores a non-image without a manifest', async () => {
    const { app } = freshApp()
    const body = new FormData()
    body.append('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', { type: 'application/pdf' }))
    const res = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(res.status).toBe(201)
    expect((await res.json() as Resp).manifest).toBeUndefined()
  })
})
