import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaManifest } from '@setu/core'
import { manifestKey } from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { createSqliteReprocessJobStore } from '@setu/db-sqlite'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'
import { runReprocessJob, type ReprocessDeps } from '../src/reprocess-runner'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

async function seedWebpOnly(
  storage: ReturnType<typeof createLocalStorage>,
  image: ReturnType<typeof createSharpImageAdapter>
) {
  const app = createUploadApi({
    storage,
    resolveActor: () => ({ id: 'o', role: 'owner' }),
    image,
    mediaSettings: { imageFormat: 'webp', imageLqip: false }
  })
  const body = new FormData()
  body.append(
    'file',
    new File([makeTestPng(400, 300)], 'p.png', { type: 'image/png' })
  )
  const r = await app.fetch(
    new Request('http://test/media', { method: 'POST', body })
  )
  return ((await r.json()) as { id: string }).id
}

describe('reprocess runner', () => {
  it('resumes from the job cursor and upgrades only the remaining manifests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpr-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const image = createSharpImageAdapter()
    const id1 = await seedWebpOnly(storage, image)
    const id2 = await seedWebpOnly(storage, image)
    const keys = [manifestKey(id1), manifestKey(id2)]
    const store = createSqliteReprocessJobStore(':memory:')
    const job = store.create(keys, 1)
    // Simulate a crash AFTER the first key: cursor already at 1, processed 1.
    store.saveProgress(job.id, 1, 1, 2)
    const deps: ReprocessDeps = {
      image,
      storage,
      media: { imageFormat: 'both', imageLqip: true },
      widths: [400, 800]
    }
    await runReprocessJob(store, deps, job.id, { chunkSize: 1, now: () => 3 })
    expect(store.get(job.id)?.status).toBe('done')
    expect(store.get(job.id)?.processed).toBe(2)
    // id2 (the remaining one) is upgraded to both+lqip
    const m2 = JSON.parse(
      new TextDecoder().decode((await storage.get(manifestKey(id2)))!.body)
    ) as MediaManifest
    expect(new Set(m2.variants.map((v) => v.format))).toEqual(
      new Set(['webp', 'avif'])
    )
    expect(m2.lqip).toMatch(/^data:image\//)
    // id1 (before the cursor) stays webp-only — resume did NOT reprocess it
    const m1 = JSON.parse(
      new TextDecoder().decode((await storage.get(manifestKey(id1)))!.body)
    ) as MediaManifest
    expect(new Set(m1.variants.map((v) => v.format))).toEqual(new Set(['webp']))
  })

  it('counts only reprocessed images — a skipped key advances the cursor but not the count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpr-mix-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const image = createSharpImageAdapter()
    // One real manifest (will reprocess → 'done') and one whose original is gone (→ 'skipped').
    const realId = await seedWebpOnly(storage, image)
    const goneManifest: MediaManifest = {
      id: '2026/01/gone',
      format: 'webp',
      original: {
        key: '2026/01/gone.png',
        width: 400,
        height: 300,
        format: 'png'
      },
      variants: []
    }
    await storage.put(
      manifestKey('2026/01/gone'),
      new TextEncoder().encode(JSON.stringify(goneManifest)),
      { contentType: 'application/json' }
    )
    const keys = [manifestKey(realId), manifestKey('2026/01/gone')]
    const store = createSqliteReprocessJobStore(':memory:')
    const job = store.create(keys, 0)
    const deps: ReprocessDeps = {
      image,
      storage,
      media: { imageFormat: 'both', imageLqip: true },
      widths: [400, 800]
    }
    await runReprocessJob(store, deps, job.id, { chunkSize: 10, now: () => 1 })
    const done = store.get(job.id)!
    expect(done.status).toBe('done')
    expect(done.total).toBe(2) // both keys were walked
    expect(done.cursor).toBe(2) // cursor reached the end (resume would not revisit the skipped one)
    expect(done.processed).toBe(1) // but only the real image counts as reprocessed
  })
})
