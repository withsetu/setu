/** Demo Data control plane (#513, epic #509) — the dev-only API the admin's
 *  Demo Data panel drives. Wraps the @setu/demo-data seed engine in the same
 *  async-job + status-polling shape the media reprocess route established
 *  (packages/core/src/reprocess/job.ts) — deliberately NOT SSE, per the #512
 *  design comment.
 *
 *  Gating (two independent layers, both required):
 *  - `enabled` — server.ts passes `mode === 'local' && NODE_ENV !== 'production'`
 *    (the createPreviewApi precedent, #419): when false the routes are
 *    PHYSICALLY ABSENT and everything under /api/demo 404s. Dev tooling never
 *    exists on a real server.
 *  - authz — every route requires a session (401) AND `users.delete` (403
 *    otherwise): seeding creates accounts across all four roles and unseeding
 *    hard-deletes them, and `users.delete` is the admin-only action in the
 *    matrix that honestly names that power (no new Action invented, per the
 *    #359 vocabulary rule).
 *
 *  The job store is a single in-memory slot: ONE job at a time (starting a
 *  second → 409 job-running — single-writer honesty: git-local serializes
 *  in-process, and two seeds interleaving over one sandbox is never what a
 *  dev wants). In-memory is honest for dev tooling: an api restart forgets the
 *  job RECORD, but the engine's own checkpoint/manifest (crash-safe by design,
 *  #512) makes a re-run resume instead of redoing work. Seeded passwords ride
 *  the terminal job summary — admin-gated, dev-only, never logged. */
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Action, Actor } from '@setu/core'
import type { RemoveSummary, SeedProgress, SeedSummary } from '@setu/demo-data'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'
import { apiOnError } from './errors'

const authz = createAuthz(DEFAULT_ROLES)

function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** JSON bodies here are tiny config objects — this is a DoS ceiling, not a limit. */
const DEMO_MAX_BYTES = 64 * 1024

// ---------------------------------------------------------------------------
// Engine seam — the real implementation (demo-wiring.ts) drives
// @setu/demo-data + the fs/git reset primitives; tests inject fakes so no
// route test ever downloads, shells out, or touches sharp/sqlite.
// ---------------------------------------------------------------------------

export interface DemoDatasetStatus {
  present: boolean
  /** 'dump' = the full extracted AIC dump, 'sample' = a bounded .jsonl slice. */
  kind: 'dump' | 'sample' | null
}

export interface DemoResetSummary {
  /** What the manifest-driven removal deleted (demo users, seeded media, …). */
  removed: RemoveSummary
  /** Content/taxonomy files deleted by the reset commit. */
  filesRemoved: number
  /** Sample files restored ('sample' level; 0 for 'zero'). */
  filesRestored: number
}

export interface DemoSeedRequest {
  posts: number
  users: Record<'admin' | 'maintainer' | 'editor' | 'author', number>
  draftFraction: number
  relaxText: boolean
  limitImages?: number
  /** Source-width mix for featured images (engine SeedOptions.imageWidthMix).
   *  Undefined = the engine default (400/843/843/1686). The WIRE carries the
   *  `imageSizeMix` enum, never raw arrays — this is the mapped result. */
  imageWidthMix?: readonly number[]
  onProgress: (p: SeedProgress) => void
  signal: AbortSignal
}

export interface DemoRunContext {
  onProgress: (p: SeedProgress) => void
  signal: AbortSignal
}

export interface DemoEngine {
  datasetStatus(): Promise<DemoDatasetStatus>
  seed(request: DemoSeedRequest): Promise<SeedSummary>
  removeGenerated(ctx: DemoRunContext): Promise<RemoveSummary>
  resetSample(ctx: DemoRunContext): Promise<DemoResetSummary>
  resetZero(ctx: DemoRunContext): Promise<DemoResetSummary>
  fetchDump(ctx: {
    onProgress: (phase: 'download' | 'extract') => void
    signal: AbortSignal
  }): Promise<void>
}

// ---------------------------------------------------------------------------
// Job record — the polled shape.
// ---------------------------------------------------------------------------

export type DemoJobKind =
  | 'seed'
  | 'unseed-generated'
  | 'reset-sample'
  | 'reset-zero'
  | 'fetch-dump'
export type DemoJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface DemoJob {
  id: string
  kind: DemoJobKind
  status: DemoJobStatus
  /** Engine phase label ('users' | 'plan' | 'categories' | 'images' | 'posts'
   *  for seeds/removals; 'download' | 'extract' for the dump fetch). */
  phase: string
  done: number
  total: number
  imageFailures: number
  warnings: string[]
  /** False for the dump download — safeFetch buffers the whole body, so there
   *  is no honest way to stop it mid-flight; the panel hides Cancel. */
  cancellable: boolean
  error?: string
  startedAt: number
  finishedAt?: number
  seedSummary?: SeedSummary
  removeSummary?: RemoveSummary
  resetSummary?: DemoResetSummary
}

// ---------------------------------------------------------------------------
// Request validation (Zod at the boundary; strict = an unknown key is a
// client bug, not something to silently ignore).
// ---------------------------------------------------------------------------

/** Hard post cap — the epic's largest benchmark tier (#515). */
export const DEMO_MAX_POSTS = 30_000
/** Per-role user cap — demo staff, not a load test of the auth table. */
export const DEMO_MAX_USERS_PER_ROLE = 50

/** Named image-size presets → engine width arrays. The wire carries this enum
 *  only (never raw arrays); 'mixed' maps to undefined so the engine default
 *  ([400, 843, 843, 1686]) stays the single source of truth for the mix. */
export const IMAGE_SIZE_MIXES = {
  mixed: undefined,
  small: [400],
  large: [1686]
} as const
export type ImageSizeMix = keyof typeof IMAGE_SIZE_MIXES

const perRole = z.number().int().min(0).max(DEMO_MAX_USERS_PER_ROLE)
const seedSchema = z
  .object({
    posts: z.number().int().min(0).max(DEMO_MAX_POSTS),
    users: z
      .object({
        admin: perRole,
        maintainer: perRole,
        editor: perRole,
        author: perRole
      })
      .strict(),
    draftFraction: z.number().min(0).max(1),
    relaxText: z.boolean(),
    limitImages: z.number().int().min(0).max(DEMO_MAX_POSTS).optional(),
    imageSizeMix: z.enum(['mixed', 'small', 'large']).optional()
  })
  .strict()

const unseedSchema = z
  .object({ level: z.enum(['generated', 'sample', 'zero']) })
  .strict()

export interface DemoApiOptions {
  /** Mount the routes at all? server.ts passes
   *  `mode === 'local' && NODE_ENV !== 'production'` — outside that, every
   *  /api/demo path 404s (routes absent, not hidden). */
  enabled: boolean
  resolveActor: ResolveActor
  /** The engine, or a lazy thunk so server.ts can defer loading
   *  @setu/demo-data's module graph until the first demo request. */
  engine: DemoEngine | (() => Promise<DemoEngine>)
  /** Called after any job that changed content/media/users lands — server.ts
   *  refreshes the server-side content + media indexes here. */
  onContentMutated?: () => void
  now?: () => number
}

export function createDemoApi(opts: DemoApiOptions) {
  const app = new Hono<{ Variables: { actor: Actor } }>()
  app.onError(apiOnError({ scope: 'demo' }))
  if (!opts.enabled) return app // not dev/local: no routes → 404 (preview.ts precedent)

  const now = opts.now ?? Date.now
  let enginePromise: Promise<DemoEngine> | null = null
  const getEngine = (): Promise<DemoEngine> => {
    if (!enginePromise)
      enginePromise =
        typeof opts.engine === 'function'
          ? opts.engine()
          : Promise.resolve(opts.engine)
    return enginePromise
  }

  // The single job slot + its abort controller.
  let job: DemoJob | null = null
  let controller: AbortController | null = null

  const running = (): boolean => job !== null && job.status === 'running'

  /** Map an engine progress event into the polled record. */
  const applyProgress = (target: DemoJob, p: SeedProgress): void => {
    switch (p.phase) {
      case 'warning':
        target.warnings.push(p.message)
        return
      case 'categories':
        target.phase = 'categories'
        target.done = Math.abs(p.added)
        target.total = Math.abs(p.added)
        return
      case 'images':
        target.phase = 'images'
        target.done = p.done
        target.total = p.total
        target.imageFailures = p.failed
        return
      default:
        target.phase = p.phase
        target.done = p.done
        target.total = p.total
    }
  }

  // --- Atomic single-slot reservation -------------------------------------
  // The busy check and the slot write MUST happen in the same synchronous
  // stretch: a starter that checked `running()` and then awaited (engine load,
  // dataset probe) before claiming the slot would let two near-simultaneous
  // POSTs both pass, the second overwriting job/controller and orphaning the
  // first run (uncancellable, interleaved writes). So every starter first
  // calls `reserveJob` — synchronous, no awaits between check and write —
  // then does its async prep, and either `releaseJob`s on prep failure or
  // `launchJob`s the real work.

  interface Reservation {
    record: DemoJob
    ctrl: AbortController
    /** The slot contents before this reservation, restored on release so a
     *  failed prep doesn't erase the previous terminal job from status. */
    prevJob: DemoJob | null
    prevController: AbortController | null
  }

  /** Claim the slot synchronously; null when a job is already running. */
  const reserveJob = (
    kind: DemoJobKind,
    cancellable: boolean
  ): Reservation | null => {
    if (running()) return null
    const record: DemoJob = {
      id: randomUUID(),
      kind,
      status: 'running',
      phase: 'starting',
      done: 0,
      total: 0,
      imageFailures: 0,
      warnings: [],
      cancellable,
      startedAt: now()
    }
    const reservation: Reservation = {
      record,
      ctrl: new AbortController(),
      prevJob: job,
      prevController: controller
    }
    job = record
    controller = reservation.ctrl
    return reservation
  }

  /** Undo a reservation whose async prep failed (nothing ran). */
  const releaseJob = (reservation: Reservation): void => {
    if (job === reservation.record) {
      job = reservation.prevJob
      controller = reservation.prevController
    }
  }

  /** Start the reserved job's work; the caller returns the 202 immediately. */
  const launchJob = (
    reservation: Reservation,
    run: (record: DemoJob, signal: AbortSignal) => Promise<void>
  ): void => {
    const { record, ctrl } = reservation
    void run(record, ctrl.signal)
      .then(() => {
        // A run that resolved after abort was requested still counts as cancelled.
        record.status = ctrl.signal.aborted ? 'cancelled' : 'done'
        record.finishedAt = now()
        if (record.kind !== 'fetch-dump') opts.onContentMutated?.()
      })
      .catch((err: unknown) => {
        record.status = ctrl.signal.aborted ? 'cancelled' : 'failed'
        record.error = err instanceof Error ? err.message : String(err)
        record.finishedAt = now()
        // A failed/aborted run may still have committed chunks before stopping.
        if (record.kind !== 'fetch-dump') opts.onContentMutated?.()
      })
  }

  const auth = authMiddleware(opts.resolveActor)
  const gate = requireCan('users.delete')

  app.get('/api/demo/status', auth, gate, async (c) => {
    const engine = await getEngine()
    const dataset = await engine.datasetStatus()
    // c.json stringifies the CURRENT job state into this response now…
    const res = c.json({ dataset, job })
    // …then honor the panel's "shown once" promise server-side: the first
    // terminal status response is the only one that ever carries the seeded
    // passwords — strip them from the stored record afterwards, keeping the
    // rest of the summary intact for later polls.
    if (
      job !== null &&
      job.status !== 'running' &&
      job.seedSummary !== undefined &&
      job.seedSummary.users.some((u) => u.password !== null)
    ) {
      job.seedSummary = {
        ...job.seedSummary,
        users: job.seedSummary.users.map((u) => ({ ...u, password: null }))
      }
    }
    return res
  })

  app.post(
    '/api/demo/seed',
    auth,
    gate,
    bodyLimit({
      maxSize: DEMO_MAX_BYTES,
      onError: (c) => c.json({ error: 'payload too large' }, 413)
    }),
    async (c) => {
      const parsed = seedSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success)
        return c.json(
          { error: 'invalid body', issues: parsed.error.issues },
          400
        )
      // Reserve BEFORE any await (see the reservation comment above).
      const reservation = reserveJob('seed', true)
      if (reservation === null) return c.json({ error: 'job-running' }, 409)
      let engine: DemoEngine
      try {
        engine = await getEngine()
        // "Dump missing" is a first-class state the panel offers a download
        // for, never a mid-job crash with a cryptic engine message.
        const dataset = await engine.datasetStatus()
        if (!dataset.present) {
          releaseJob(reservation)
          return c.json({ error: 'source-missing' }, 409)
        }
      } catch (err) {
        releaseJob(reservation)
        throw err // → the scoped apiOnError envelope
      }
      const body = parsed.data
      const widthMix = IMAGE_SIZE_MIXES[body.imageSizeMix ?? 'mixed']
      launchJob(reservation, async (rec, signal) => {
        rec.seedSummary = await engine.seed({
          posts: body.posts,
          users: body.users,
          draftFraction: body.draftFraction,
          relaxText: body.relaxText,
          ...(body.limitImages !== undefined
            ? { limitImages: body.limitImages }
            : {}),
          ...(widthMix !== undefined ? { imageWidthMix: widthMix } : {}),
          onProgress: (p) => applyProgress(rec, p),
          signal
        })
        rec.imageFailures = rec.seedSummary.imageFailures
      })
      return c.json({ id: reservation.record.id }, 202)
    }
  )

  app.post(
    '/api/demo/unseed',
    auth,
    gate,
    bodyLimit({
      maxSize: DEMO_MAX_BYTES,
      onError: (c) => c.json({ error: 'payload too large' }, 413)
    }),
    async (c) => {
      const parsed = unseedSchema.safeParse(
        await c.req.json().catch(() => null)
      )
      if (!parsed.success)
        return c.json(
          { error: 'invalid body', issues: parsed.error.issues },
          400
        )
      const level = parsed.data.level
      const kind: DemoJobKind =
        level === 'generated'
          ? 'unseed-generated'
          : level === 'sample'
            ? 'reset-sample'
            : 'reset-zero'
      // Reserve BEFORE any await (see the reservation comment above).
      const reservation = reserveJob(kind, true)
      if (reservation === null) return c.json({ error: 'job-running' }, 409)
      let engine: DemoEngine
      try {
        engine = await getEngine()
      } catch (err) {
        releaseJob(reservation)
        throw err
      }
      launchJob(reservation, async (rec, signal) => {
        const ctx = {
          onProgress: (p: SeedProgress) => applyProgress(rec, p),
          signal
        }
        if (level === 'generated')
          rec.removeSummary = await engine.removeGenerated(ctx)
        else if (level === 'sample')
          rec.resetSummary = await engine.resetSample(ctx)
        else rec.resetSummary = await engine.resetZero(ctx)
      })
      return c.json({ id: reservation.record.id }, 202)
    }
  )

  app.post('/api/demo/fetch-dump', auth, gate, async (c) => {
    // Reserve BEFORE any await (see the reservation comment above).
    const reservation = reserveJob('fetch-dump', false)
    if (reservation === null) return c.json({ error: 'job-running' }, 409)
    let engine: DemoEngine
    try {
      engine = await getEngine()
    } catch (err) {
      releaseJob(reservation)
      throw err
    }
    launchJob(reservation, async (rec, signal) => {
      await engine.fetchDump({
        onProgress: (phase) => {
          rec.phase = phase
        },
        signal
      })
    })
    return c.json({ id: reservation.record.id }, 202)
  })

  app.post('/api/demo/cancel', auth, gate, (c) => {
    if (!running() || controller === null)
      return c.json({ error: 'no-job' }, 409)
    if (!job?.cancellable) return c.json({ error: 'not-cancellable' }, 409)
    controller.abort()
    return c.json({ ok: true })
  })

  return app
}
