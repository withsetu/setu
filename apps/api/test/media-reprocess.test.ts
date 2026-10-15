import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Actor,
  MediaManifest,
  MediaSettings,
  StoragePort
} from '@setu/core'
import { manifestKey } from '@setu/core'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createSqliteReprocessJobStore } from '@setu/db-sqlite'
import { createUploadApi } from '../src/media'
import { runReprocessJob } from '../src/reprocess-runner'

const owner: Actor = { id: 'local', role: 'admin' }
const author: Actor = { id: 'a', role: 'author' }

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe('POST /api/media/reprocess', () => {
  it(
    'starts a job, reports progress, and upgrades the library (both+lqip)',
    { timeout: 30_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'reprocess-'))
      dirs.push(dir)
      const storage = createLocalStorage({
        dir,
        baseUrl: 'http://localhost:4444/media'
      })
      const image = createSharpImageAdapter()
      const store = createSqliteReprocessJobStore(':memory:')
      let current: MediaSettings = { imageFormat: 'webp', imageLqip: false }
      // Store the runner promise so the test can await it for determinism
      let runnerPromise: Promise<void> = Promise.resolve()
      const app = createUploadApi({
        storage,
        resolveActor: () => owner,
        image,
        mediaSettings: () => current,
        reprocess: {
          store,
          run: (jobId) => {
            runnerPromise = runReprocessJob(
              store,
              { image, storage, media: current, widths: [400, 800] },
              jobId,
              { chunkSize: 10 }
            )
          }
        }
      })
      const body = new FormData()
      body.append(
        'file',
        new File([makeTestPng(400, 300)], 'pic.png', { type: 'image/png' })
      )
      const up = await app.fetch(
        new Request('http://test/media', { method: 'POST', body })
      )
      const uploaded = (await up.json()) as { id: string }

      current = { imageFormat: 'both', imageLqip: true }
      const start = await app.fetch(
        new Request('http://test/api/media/reprocess', { method: 'POST' })
      )
      expect(start.status).toBe(202)
      const { jobId } = (await start.json()) as { jobId: string }
      expect(jobId).toBeTruthy()
      // Await the runner promise for determinism
      await runnerPromise
      const st = await app.fetch(
        new Request('http://test/api/media/reprocess/status')
      )
      const status = (await st.json()) as {
        status: string
        processed: number
        total: number
      }
      expect(status.status).toBe('done')
      expect(status.processed).toBe(status.total)
      const m = JSON.parse(
        new TextDecoder().decode(
          (await storage.get(manifestKey(uploaded.id)))!.body
        )
      ) as MediaManifest
      expect(new Set(m.variants.map((v) => v.format))).toEqual(
        new Set(['webp', 'avif'])
      )
      expect(m.lqip).toMatch(/^data:image\//)
    }
  )

  it(
    'reads Media settings live (a getter) — a setting change applies without rebuilding the api',
    { timeout: 30_000 },
    async () => {
      // Regression: settings were captured at boot, so a format/LQIP change made in the admin was
      // ignored by uploads + reprocess until the api restarted. The api must read settings per request.
      const dir = mkdtempSync(join(tmpdir(), 'reprocess-live-'))
      dirs.push(dir)
      const storage = createLocalStorage({
        dir,
        baseUrl: 'http://localhost:4444/media'
      })
      const image = createSharpImageAdapter()
      const store = createSqliteReprocessJobStore(':memory:')

      // ONE api instance whose mediaSettings is a live getter over a mutable value.
      let current: MediaSettings = { imageFormat: 'webp', imageLqip: false }
      // Store the runner promise so the test can await it for determinism
      let runnerPromise: Promise<void> = Promise.resolve()
      const app = createUploadApi({
        storage,
        resolveActor: () => owner,
        image,
        mediaSettings: () => current,
        reprocess: {
          store,
          run: (jobId) => {
            runnerPromise = runReprocessJob(
              store,
              { image, storage, media: current, widths: [400, 800] },
              jobId,
              { chunkSize: 10 }
            )
          }
        }
      })

      const body = new FormData()
      body.append(
        'file',
        new File([makeTestPng(400, 300)], 'pic.png', { type: 'image/png' })
      )
      const uploadRes = await app.fetch(
        new Request('http://test/media', { method: 'POST', body })
      )
      expect(uploadRes.status).toBe(201)
      const uploaded = (await uploadRes.json()) as { id: string }
      const mk = manifestKey(uploaded.id)
      const m1 = JSON.parse(
        new TextDecoder().decode((await storage.get(mk))!.body)
      ) as MediaManifest
      expect(new Set(m1.variants.map((v) => v.format))).toEqual(
        new Set(['webp'])
      )
      expect(m1.lqip).toBeFalsy()

      // Simulate the admin saving new Media settings (no api rebuild/restart).
      current = { imageFormat: 'both', imageLqip: true }

      const reprocessRes = await app.fetch(
        new Request('http://test/api/media/reprocess', { method: 'POST' })
      )
      expect(reprocessRes.status).toBe(202)
      const { jobId } = (await reprocessRes.json()) as { jobId: string }
      expect(jobId).toBeTruthy()
      // Await the runner promise for determinism
      await runnerPromise
      const stRes = await app.fetch(
        new Request('http://test/api/media/reprocess/status')
      )
      const st = (await stRes.json()) as { status: string }
      expect(st.status).toBe('done')
      const m2 = JSON.parse(
        new TextDecoder().decode((await storage.get(mk))!.body)
      ) as MediaManifest
      expect(new Set(m2.variants.map((v) => v.format))).toEqual(
        new Set(['webp', 'avif'])
      )
      expect(m2.lqip).toMatch(/^data:image\//)
    }
  )

  it('401 when unauthenticated', async () => {
    // #379: reprocess is gated on media.edit, which every current staff role holds — so the only
    // deny path left is the unauthenticated one (no actor → 401). The old Viewer 403 case is gone.
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-auth-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const app = createUploadApi({ storage, resolveActor: () => null })
    const res = await app.fetch(
      new Request('http://test/api/media/reprocess', { method: 'POST' })
    )
    expect(res.status).toBe(401)
  })

  it('GET status: 401 when unauthenticated', async () => {
    // #430: reprocess job status previously had NO auth middleware. It exposes job progress and
    // implicitly the media pipeline state, so it must require media.view like the rest of the
    // control plane. No actor → 401.
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-status-auth-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const app = createUploadApi({ storage, resolveActor: () => null })
    const res = await app.fetch(
      new Request('http://test/api/media/reprocess/status')
    )
    expect(res.status).toBe(401)
  })

  it('GET status: 200 (idle) for an authenticated author (holds media.view)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-status-ok-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const app = createUploadApi({ storage, resolveActor: () => author })
    const res = await app.fetch(
      new Request('http://test/api/media/reprocess/status')
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'idle' })
  })

  it('409 when image/reprocess opts are not configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-unavail-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const app = createUploadApi({ storage, resolveActor: () => owner })
    const res = await app.fetch(
      new Request('http://test/api/media/reprocess', { method: 'POST' })
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'reprocess unavailable in this mode'
    })
  })

  it('skips manifests whose original is missing (no crash)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-skip-'))
    dirs.push(dir)
    const storage = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const image = createSharpImageAdapter()
    const store = createSqliteReprocessJobStore(':memory:')

    // Plant a manifest with a non-existent original key
    const fakeManifest: MediaManifest = {
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
      new TextEncoder().encode(JSON.stringify(fakeManifest)),
      { contentType: 'application/json' }
    )

    let runnerPromise: Promise<void> = Promise.resolve()
    const app = createUploadApi({
      storage,
      resolveActor: () => owner,
      image,
      mediaSettings: { imageFormat: 'webp', imageLqip: false },
      reprocess: {
        store,
        run: (jobId) => {
          runnerPromise = runReprocessJob(
            store,
            {
              image,
              storage,
              media: { imageFormat: 'webp', imageLqip: false },
              widths: [400, 800]
            },
            jobId,
            { chunkSize: 10 }
          )
        }
      }
    })

    const res = await app.fetch(
      new Request('http://test/api/media/reprocess', { method: 'POST' })
    )
    expect(res.status).toBe(202)
    const { jobId } = (await res.json()) as { jobId: string }
    expect(jobId).toBeTruthy()
    // Await runner for determinism; job should finish without crashing
    await runnerPromise
    const stRes = await app.fetch(
      new Request('http://test/api/media/reprocess/status')
    )
    const st = (await stRes.json()) as {
      status: string
      processed: number
      total: number
    }
    // total = 1 (the fake manifest), but processed = 0: a skipped key is NOT a reprocessed image,
    // so it must not inflate the user-facing count. The job still completes (no crash); the cursor
    // (not processed) is what guarantees we don't re-walk it on resume.
    expect(st.status).toBe('done')
    expect(st.total).toBe(1)
    expect(st.processed).toBe(0)
  })
})

describe('POST /api/media/reprocess — single-flight under concurrency (#1276)', () => {
  /** A real local storage whose `list()` — the await inside the route, before the job exists —
   *  is held open on a deferred the test releases, so both requests are provably inside that
   *  window together. `failNext` makes the next held list() reject instead. */
  function harness() {
    const dir = mkdtempSync(join(tmpdir(), 'reprocess-sf-'))
    dirs.push(dir)
    const base = createLocalStorage({
      dir,
      baseUrl: 'http://localhost:4444/media'
    })
    const pending: Array<{ go: () => void; fail: () => void }> = []
    const storage: StoragePort = {
      ...base,
      list: (...args: Parameters<StoragePort['list']>) =>
        new Promise((resolve, reject) => {
          pending.push({
            go: () => resolve(base.list(...args)),
            fail: () => reject(new Error('storage list failed'))
          })
        })
    }
    const store = createSqliteReprocessJobStore(':memory:')
    const create = vi.spyOn(store, 'create')
    // The runner is a no-op: the job stays `running`, which is the window under test.
    const run = vi.fn()
    const app = createUploadApi({
      storage,
      resolveActor: () => owner,
      image: createSharpImageAdapter(),
      mediaSettings: { imageFormat: 'webp', imageLqip: false },
      reprocess: { store, run }
    })
    const post = () =>
      Promise.resolve(
        app.fetch(
          new Request('http://test/api/media/reprocess', { method: 'POST' })
        )
      )
    /** Let queued microtasks/handlers reach their await before releasing. */
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    }
    return { post, pending, create, run, settle }
  }

  it('two concurrent requests create exactly one job; both get 202 with its id', async () => {
    const h = harness()
    const first = h.post()
    const second = h.post()
    await h.settle()
    // Only the claimant may list the library — the second request never starts a scan.
    expect(h.pending).toHaveLength(1)
    h.pending[0]!.go()
    const [a, b] = await Promise.all([first, second])
    expect(a.status).toBe(202)
    expect(b.status).toBe(202)
    const ja = (await a.json()) as { jobId: string; status: string }
    const jb = (await b.json()) as { jobId: string; status: string }
    expect(jb.jobId).toBe(ja.jobId)
    expect(jb.status).toBe('running')
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.run).toHaveBeenCalledTimes(1)
  })

  it('a failed library scan releases the claim: a waiting request starts its own job', async () => {
    const h = harness()
    const first = h.post()
    const second = h.post()
    await h.settle()
    expect(h.pending).toHaveLength(1)
    h.pending[0]!.fail()
    const a = await first
    expect(a.status).toBe(500)
    expect(h.create).not.toHaveBeenCalled()
    // The waiter retried on its own and is now the claimant.
    await h.settle()
    expect(h.pending).toHaveLength(2)
    h.pending[1]!.go()
    const b = await second
    expect(b.status).toBe(202)
    expect(h.create).toHaveBeenCalledTimes(1)
    // And a later request sees the running job rather than starting another.
    const c = await h.post()
    expect(c.status).toBe(202)
    expect(((await c.json()) as { jobId: string }).jobId).toBe(
      ((await b.json()) as { jobId: string }).jobId
    )
    expect(h.create).toHaveBeenCalledTimes(1)
  })
})
