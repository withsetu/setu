import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, MediaManifest, MediaSettings } from '@setu/core'
import { manifestKey } from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'

const owner: Actor = { id: 'local', role: 'owner' }
const viewer: Actor = { id: 'v', role: 'viewer' }

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe('POST /media/reprocess', () => {
  it('regenerates every image with current settings', async () => {
    // Step 1: build the api with webp-only, no lqip; upload a PNG
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-'))
    dirs.push(dir)
    const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
    const image = createSharpImageAdapter()

    const appV1 = createUploadApi({
      storage,
      resolveActor: () => owner,
      image,
      mediaSettings: { imageFormat: 'webp', imageLqip: false },
    })

    const body = new FormData()
    body.append('file', new File([makeTestPng(400, 300)], 'pic.png', { type: 'image/png' }))
    const uploadRes = await appV1.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(uploadRes.status).toBe(201)
    const uploaded = (await uploadRes.json()) as { id: string; manifest?: MediaManifest }
    expect(uploaded.manifest).toBeTruthy()

    // Step 2: confirm initial manifest has only webp, no lqip
    const mk = manifestKey(uploaded.id)
    const rawV1 = await storage.get(mk)
    expect(rawV1).not.toBeNull()
    const manifestV1 = JSON.parse(new TextDecoder().decode(rawV1!.body)) as MediaManifest
    const formatsV1 = new Set(manifestV1.variants.map((v) => v.format))
    expect(formatsV1).toEqual(new Set(['webp']))
    expect(manifestV1.lqip).toBeFalsy()

    // Step 3: rebuild/reconfigure the api with both formats + lqip
    const appV2 = createUploadApi({
      storage,
      resolveActor: () => owner,
      image,
      mediaSettings: { imageFormat: 'both', imageLqip: true },
    })

    // Step 4: POST /media/reprocess (authorized actor)
    const reprocessRes = await appV2.fetch(
      new Request('http://test/media/reprocess', { method: 'POST' }),
    )
    expect(reprocessRes.status).toBe(200)
    const reprocessJson = (await reprocessRes.json()) as { reprocessed: number }
    expect(reprocessJson.reprocessed).toBe(1)

    // Step 5: re-read the manifest: now has webp+avif variants AND an lqip data-URI
    const rawV2 = await storage.get(mk)
    expect(rawV2).not.toBeNull()
    const manifestV2 = JSON.parse(new TextDecoder().decode(rawV2!.body)) as MediaManifest
    const formatsV2 = new Set(manifestV2.variants.map((v) => v.format))
    expect(formatsV2).toEqual(new Set(['webp', 'avif']))
    expect(manifestV2.lqip).toBeTruthy()
    expect(manifestV2.lqip).toMatch(/^data:image\//)
  })

  it('reads Media settings live (a getter) — a setting change applies without rebuilding the api', async () => {
    // Regression: settings were captured at boot, so a format/LQIP change made in the admin was
    // ignored by uploads + reprocess until the api restarted. The api must read settings per request.
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-live-'))
    dirs.push(dir)
    const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
    const image = createSharpImageAdapter()

    // ONE api instance whose mediaSettings is a live getter over a mutable value.
    let current: MediaSettings = { imageFormat: 'webp', imageLqip: false }
    const app = createUploadApi({
      storage,
      resolveActor: () => owner,
      image,
      mediaSettings: () => current,
    })

    const body = new FormData()
    body.append('file', new File([makeTestPng(400, 300)], 'pic.png', { type: 'image/png' }))
    const uploadRes = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(uploadRes.status).toBe(201)
    const uploaded = (await uploadRes.json()) as { id: string }
    const mk = manifestKey(uploaded.id)
    const m1 = JSON.parse(new TextDecoder().decode((await storage.get(mk))!.body)) as MediaManifest
    expect(new Set(m1.variants.map((v) => v.format))).toEqual(new Set(['webp']))
    expect(m1.lqip).toBeFalsy()

    // Simulate the admin saving new Media settings (no api rebuild/restart).
    current = { imageFormat: 'both', imageLqip: true }

    const reprocessRes = await app.fetch(new Request('http://test/media/reprocess', { method: 'POST' }))
    expect(reprocessRes.status).toBe(200)
    const m2 = JSON.parse(new TextDecoder().decode((await storage.get(mk))!.body)) as MediaManifest
    expect(new Set(m2.variants.map((v) => v.format))).toEqual(new Set(['webp', 'avif']))
    expect(m2.lqip).toMatch(/^data:image\//)
  })

  it('401 when unauthenticated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-auth-'))
    dirs.push(dir)
    const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
    const app = createUploadApi({ storage, resolveActor: () => null })
    const res = await app.fetch(new Request('http://test/media/reprocess', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('403 when the actor lacks content.create', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-authz-'))
    dirs.push(dir)
    const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
    const app = createUploadApi({ storage, resolveActor: () => viewer })
    const res = await app.fetch(new Request('http://test/media/reprocess', { method: 'POST' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('skips manifests whose original is missing (no crash)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-skip-'))
    dirs.push(dir)
    const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
    const image = createSharpImageAdapter()

    // Plant a manifest with a non-existent original key
    const fakeManifest: MediaManifest = {
      id: '2026/01/gone',
      format: 'webp',
      original: { key: '2026/01/gone.png', width: 400, height: 300, format: 'png' },
      variants: [],
    }
    await storage.put(
      manifestKey('2026/01/gone'),
      new TextEncoder().encode(JSON.stringify(fakeManifest)),
      { contentType: 'application/json' },
    )

    const app = createUploadApi({
      storage,
      resolveActor: () => owner,
      image,
      mediaSettings: { imageFormat: 'webp', imageLqip: false },
    })

    const res = await app.fetch(new Request('http://test/media/reprocess', { method: 'POST' }))
    expect(res.status).toBe(200)
    // Should be 0 reprocessed because the original was missing
    expect((await res.json() as { reprocessed: number }).reprocessed).toBe(0)
  })
})
