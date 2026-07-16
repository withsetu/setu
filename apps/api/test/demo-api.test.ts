/** Demo Data control plane (#513): route gating, authz, job lifecycle.
 *
 *  The engine is ALWAYS injected as a fake here — these tests must never run a
 *  real seed (no network, no sharp, no sqlite); the engine's own behavior is
 *  covered by packages/demo-data's suite, and the fs/git reset implementations
 *  by demo-wiring.test.ts. */
import { describe, expect, it } from 'vitest'
import type { Actor } from '@setu/core'
import type { SeedProgress, SeedSummary, RemoveSummary } from '@setu/demo-data'
import { createDemoApi } from '../src/demo'
import type { DemoEngine, DemoResetSummary } from '../src/demo'

const admin: Actor = { id: 'local', role: 'admin' }
const author: Actor = { id: 'a', role: 'author' }

const seedSummary: SeedSummary = {
  users: [
    { email: 'demo-admin-1@demo.setu.test', role: 'admin', password: 'pw-123' }
  ],
  posts: 2,
  images: 1,
  imagesReused: 0,
  imageFailures: 1,
  commits: 2,
  skipped: {},
  durationMs: 5
}

const removeSummary: RemoveSummary = {
  posts: 2,
  media: 1,
  users: 1,
  userFailures: 0,
  usersSkipped: 0,
  categories: 1,
  durationMs: 4
}

const resetSummary: DemoResetSummary = {
  removed: removeSummary,
  filesRemoved: 3,
  filesRestored: 2
}

/** A fully controllable fake engine. Every method resolves immediately unless
 *  the test installs a gate. */
function fakeEngine(overrides: Partial<DemoEngine> = {}): DemoEngine {
  return {
    datasetStatus: async () => ({ present: true, kind: 'dump' }),
    seed: async ({ onProgress }) => {
      onProgress({ phase: 'users', done: 1, total: 1 })
      onProgress({ phase: 'images', done: 1, failed: 1, total: 2 })
      onProgress({ phase: 'posts', done: 2, total: 2 })
      return seedSummary
    },
    removeGenerated: async () => removeSummary,
    resetSample: async () => resetSummary,
    resetZero: async () => resetSummary,
    fetchDump: async () => {},
    ...overrides
  }
}

function api(
  engine: DemoEngine = fakeEngine(),
  opts: {
    enabled?: boolean
    actor?: Actor | null
    onContentMutated?: () => void
  } = {}
) {
  return createDemoApi({
    enabled: opts.enabled ?? true,
    resolveActor: () => (opts.actor === undefined ? admin : opts.actor),
    engine,
    ...(opts.onContentMutated
      ? { onContentMutated: opts.onContentMutated }
      : {})
  })
}

const post = (app: ReturnType<typeof api>, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body)
    })
  )

const get = (app: ReturnType<typeof api>, path: string) =>
  app.fetch(new Request(`http://test${path}`))

const seedBody = {
  posts: 50,
  users: { admin: 1, maintainer: 1, editor: 2, author: 5 },
  draftFraction: 0.1,
  relaxText: false
}

/** Poll the fake-clock-free way: the fake engine resolves in microtasks, so a
 *  single macrotask tick settles the job. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('gating', () => {
  it('routes are physically absent when not enabled (non-dev / non-local)', async () => {
    const app = api(fakeEngine(), { enabled: false })
    expect((await get(app, '/api/demo/status')).status).toBe(404)
    expect((await post(app, '/api/demo/seed', seedBody)).status).toBe(404)
    expect(
      (await post(app, '/api/demo/unseed', { level: 'zero' })).status
    ).toBe(404)
    expect((await post(app, '/api/demo/fetch-dump')).status).toBe(404)
    expect((await post(app, '/api/demo/cancel')).status).toBe(404)
  })

  it('401s every route without a session', async () => {
    const app = api(fakeEngine(), { actor: null })
    expect((await get(app, '/api/demo/status')).status).toBe(401)
    expect((await post(app, '/api/demo/seed', seedBody)).status).toBe(401)
    expect(
      (await post(app, '/api/demo/unseed', { level: 'zero' })).status
    ).toBe(401)
    expect((await post(app, '/api/demo/fetch-dump')).status).toBe(401)
    expect((await post(app, '/api/demo/cancel')).status).toBe(401)
  })

  it('403s the wrong actor (author) on every route', async () => {
    const app = api(fakeEngine(), { actor: author })
    expect((await get(app, '/api/demo/status')).status).toBe(403)
    expect((await post(app, '/api/demo/seed', seedBody)).status).toBe(403)
    expect(
      (await post(app, '/api/demo/unseed', { level: 'zero' })).status
    ).toBe(403)
    expect((await post(app, '/api/demo/fetch-dump')).status).toBe(403)
    expect((await post(app, '/api/demo/cancel')).status).toBe(403)
  })
})

describe('GET /api/demo/status', () => {
  it('reports the dataset and no job when idle', async () => {
    const res = await get(api(), '/api/demo/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dataset: { present: true, kind: 'dump' },
      job: null
    })
  })

  it('reports a missing dataset honestly', async () => {
    const app = api(
      fakeEngine({
        datasetStatus: async () => ({ present: false, kind: null })
      })
    )
    const res = await get(app, '/api/demo/status')
    expect(((await res.json()) as { dataset: unknown }).dataset).toEqual({
      present: false,
      kind: null
    })
  })
})

describe('POST /api/demo/seed', () => {
  it('starts a job, maps progress phases, and lands the summary (passwords included)', async () => {
    const app = api()
    const started = await post(app, '/api/demo/seed', seedBody)
    expect(started.status).toBe(202)
    const { id } = (await started.json()) as { id: string }
    expect(id).toBeTruthy()

    await settle()
    const res = await get(app, '/api/demo/status')
    const { job } = (await res.json()) as {
      job: {
        id: string
        kind: string
        status: string
        phase: string
        done: number
        total: number
        imageFailures: number
        cancellable: boolean
        seedSummary?: SeedSummary
      }
    }
    expect(job.id).toBe(id)
    expect(job.kind).toBe('seed')
    expect(job.status).toBe('done')
    expect(job.phase).toBe('posts')
    expect(job.done).toBe(2)
    expect(job.total).toBe(2)
    expect(job.imageFailures).toBe(1)
    expect(job.cancellable).toBe(true)
    expect(job.seedSummary).toEqual(seedSummary)
  })

  it('forwards the validated options to the engine', async () => {
    let received: unknown
    const app = api(
      fakeEngine({
        seed: async (opts) => {
          received = opts
          return seedSummary
        }
      })
    )
    await post(app, '/api/demo/seed', {
      ...seedBody,
      relaxText: true,
      limitImages: 10
    })
    await settle()
    expect(received).toMatchObject({
      posts: 50,
      users: { admin: 1, maintainer: 1, editor: 2, author: 5 },
      draftFraction: 0.1,
      relaxText: true,
      limitImages: 10
    })
  })

  it('409s with source-missing when no dataset is fetched (never a cryptic failure)', async () => {
    const app = api(
      fakeEngine({
        datasetStatus: async () => ({ present: false, kind: null })
      })
    )
    const res = await post(app, '/api/demo/seed', seedBody)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'source-missing' })
  })

  it('rejects out-of-cap bodies (Zod at the boundary)', async () => {
    const app = api()
    expect(
      (await post(app, '/api/demo/seed', { ...seedBody, posts: 30001 })).status
    ).toBe(400)
    expect(
      (await post(app, '/api/demo/seed', { ...seedBody, draftFraction: 1.5 }))
        .status
    ).toBe(400)
    expect(
      (
        await post(app, '/api/demo/seed', {
          ...seedBody,
          users: { ...seedBody.users, admin: 51 }
        })
      ).status
    ).toBe(400)
    expect((await post(app, '/api/demo/seed', { posts: 50 })).status).toBe(400)
    // an unknown key is a client bug — strict schema
    expect(
      (await post(app, '/api/demo/seed', { ...seedBody, concurrency: 64 }))
        .status
    ).toBe(400)
  })

  it('is single-writer: 409 job-running while one runs', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const app = api(
      fakeEngine({
        seed: async () => {
          await gate
          return seedSummary
        }
      })
    )
    expect((await post(app, '/api/demo/seed', seedBody)).status).toBe(202)
    const second = await post(app, '/api/demo/seed', seedBody)
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'job-running' })
    // …and the other starters are blocked by the same slot
    expect(
      (await post(app, '/api/demo/unseed', { level: 'zero' })).status
    ).toBe(409)
    expect((await post(app, '/api/demo/fetch-dump')).status).toBe(409)
    release()
    await settle()
    expect((await post(app, '/api/demo/seed', seedBody)).status).toBe(202)
  })

  it('marks a failed run failed with the message', async () => {
    const app = api(
      fakeEngine({
        seed: async () => {
          throw new Error('sandbox is not a git repository')
        }
      })
    )
    await post(app, '/api/demo/seed', seedBody)
    await settle()
    const { job } = (await (await get(app, '/api/demo/status')).json()) as {
      job: { status: string; error?: string }
    }
    expect(job.status).toBe('failed')
    expect(job.error).toContain('not a git repository')
  })
})

describe('POST /api/demo/unseed', () => {
  it('generated → removeGenerated', async () => {
    let called = 0
    const app = api(
      fakeEngine({
        removeGenerated: async () => {
          called++
          return removeSummary
        }
      })
    )
    const res = await post(app, '/api/demo/unseed', { level: 'generated' })
    expect(res.status).toBe(202)
    await settle()
    expect(called).toBe(1)
    const { job } = (await (await get(app, '/api/demo/status')).json()) as {
      job: { kind: string; status: string; removeSummary?: RemoveSummary }
    }
    expect(job.kind).toBe('unseed-generated')
    expect(job.status).toBe('done')
    expect(job.removeSummary).toEqual(removeSummary)
  })

  it('sample → resetSample; zero → resetZero', async () => {
    const calls: string[] = []
    const engine = fakeEngine({
      resetSample: async () => {
        calls.push('sample')
        return resetSummary
      },
      resetZero: async () => {
        calls.push('zero')
        return resetSummary
      }
    })
    const app = api(engine)
    await post(app, '/api/demo/unseed', { level: 'sample' })
    await settle()
    await post(app, '/api/demo/unseed', { level: 'zero' })
    await settle()
    expect(calls).toEqual(['sample', 'zero'])
    const { job } = (await (await get(app, '/api/demo/status')).json()) as {
      job: { kind: string; resetSummary?: DemoResetSummary }
    }
    expect(job.kind).toBe('reset-zero')
    expect(job.resetSummary).toEqual(resetSummary)
  })

  it('rejects unknown levels', async () => {
    expect(
      (await post(api(), '/api/demo/unseed', { level: 'everything' })).status
    ).toBe(400)
  })

  it('notifies onContentMutated after a mutating job lands', async () => {
    let mutated = 0
    const app = api(fakeEngine(), { onContentMutated: () => mutated++ })
    await post(app, '/api/demo/unseed', { level: 'generated' })
    await settle()
    expect(mutated).toBe(1)
  })
})

describe('POST /api/demo/fetch-dump', () => {
  it('runs as a non-cancellable job and re-reports the dataset after', async () => {
    let fetched = 0
    let present = false
    const app = api(
      fakeEngine({
        datasetStatus: async () => ({ present, kind: present ? 'dump' : null }),
        fetchDump: async ({ onProgress }) => {
          onProgress('download')
          onProgress('extract')
          fetched++
          present = true
        }
      })
    )
    const res = await post(app, '/api/demo/fetch-dump')
    expect(res.status).toBe(202)
    await settle()
    expect(fetched).toBe(1)
    const body = (await (await get(app, '/api/demo/status')).json()) as {
      dataset: { present: boolean }
      job: { kind: string; status: string; phase: string; cancellable: boolean }
    }
    expect(body.job.kind).toBe('fetch-dump')
    expect(body.job.status).toBe('done')
    expect(body.job.phase).toBe('extract')
    expect(body.job.cancellable).toBe(false)
    expect(body.dataset.present).toBe(true)
  })
})

describe('POST /api/demo/cancel', () => {
  it('aborts the running job and marks it cancelled', async () => {
    let releasedSignal: AbortSignal | undefined
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const app = api(
      fakeEngine({
        seed: async ({ signal }) => {
          releasedSignal = signal
          await gate
          signal.throwIfAborted()
          return seedSummary
        }
      })
    )
    await post(app, '/api/demo/seed', seedBody)
    const res = await post(app, '/api/demo/cancel')
    expect(res.status).toBe(200)
    expect(releasedSignal?.aborted).toBe(true)
    release()
    await settle()
    const { job } = (await (await get(app, '/api/demo/status')).json()) as {
      job: { status: string }
    }
    expect(job.status).toBe('cancelled')
  })

  it('409s when nothing is running', async () => {
    const res = await post(api(), '/api/demo/cancel')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no-job' })
  })

  it('409s for a non-cancellable job (dump download cannot stop mid-flight)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const app = api(
      fakeEngine({
        fetchDump: async () => {
          await gate
        }
      })
    )
    await post(app, '/api/demo/fetch-dump')
    const res = await post(app, '/api/demo/cancel')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not-cancellable' })
    release()
    await settle()
  })
})

describe('progress mapping', () => {
  it('collects warnings and live phase counts while running', async () => {
    let emit!: (p: SeedProgress) => void
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const app = api(
      fakeEngine({
        seed: async ({ onProgress }) => {
          emit = onProgress
          await gate
          return seedSummary
        }
      })
    )
    await post(app, '/api/demo/seed', seedBody)
    await settle()
    emit({ phase: 'warning', message: 'a dev api appears to be running' })
    emit({ phase: 'images', done: 3, failed: 2, total: 10 })
    const { job } = (await (await get(app, '/api/demo/status')).json()) as {
      job: {
        status: string
        phase: string
        done: number
        total: number
        imageFailures: number
        warnings: string[]
      }
    }
    expect(job.status).toBe('running')
    expect(job.phase).toBe('images')
    expect(job.done).toBe(3)
    expect(job.total).toBe(10)
    expect(job.imageFailures).toBe(2)
    expect(job.warnings).toEqual(['a dev api appears to be running'])
    release()
    await settle()
  })
})
