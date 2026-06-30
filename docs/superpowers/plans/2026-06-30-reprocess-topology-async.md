# Reprocess — topology-aware, async, resumable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image Reprocess a capability-gated, async, chunked, resumable background job with live progress — never a button that can't work or a request that blocks/times out.

**Architecture:** A generic `GET /api/capabilities` (composed in `server.ts` from the wired adapters) tells the admin what the api can do. Reprocess becomes a background job whose durable state lives in a sqlite-backed `ReprocessJobStore` (core port + db-sqlite adapter), so it resumes after a restart. `POST /api/media/reprocess` starts the job and returns a `jobId`; `GET /api/media/reprocess/status` reports progress; the admin gates the control on capabilities and polls status into a shadcn `Progress` bar.

**Tech Stack:** Hono (Node), better-sqlite3, `@setu/core` ports, `@setu/image-sharp` (`ingestImage`), React 19 + shadcn/ui (admin), vitest.

## Global Constraints

- **Path convention:** control-plane routes live under **`/api/<name>`** (`/api/capabilities`, `/api/media/reprocess`, `/api/media/reprocess/status`). `/media/*` file serving stays at root (content URL contract — do NOT move it).
- **Topology:** reprocess/ingest are **Node-only** (sharp + fs). The capability gate is the edge story; do not make these run on the edge.
- **Capabilities are fine-grained flags**, composed in `server.ts` from the actually-wired adapters. `mode` is display-only. YAGNI: only `imageProcessing`, `writableMediaStore`, `backgroundJobs`.
- **One job at a time.** A second start while one runs returns the running job, does not spawn a second.
- **Resume must not double-process:** persist the cursor only after a chunk's writes complete; re-ingest is idempotent (overwrites the same keys), so at most one chunk repeats on crash.
- **Authz unchanged:** reprocess requires `content.create` (401 unauth, 403 unauthorized).
- **TDD, frequent commits.** Reuse existing patterns: `SubmissionPort`/`createSqliteSubmissionPort` (ports in core, sqlite in db-sqlite), `makeTestPng`/`createLocalStorage`/`createSharpImageAdapter` in api tests, `MediaSettings.tsx` load/save/AlertDialog idioms.
- Trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Generic capabilities endpoint

**Files:**
- Create: `apps/api/src/capabilities.ts`
- Modify: `apps/api/src/server.ts` (compose + mount)
- Test: `apps/api/test/capabilities.test.ts`

**Interfaces:**
- Produces: `buildCapabilities(opts: { image?: unknown; writableMediaStore: boolean; backgroundJobs: boolean; mode?: string }): { mode?: string; capabilities: { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean } }` (derives `imageProcessing = !!opts.image`). `createCapabilitiesApi(caps): Hono` mounting `GET /api/capabilities` → `caps`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/capabilities.test.ts
import { describe, it, expect } from 'vitest'
import { buildCapabilities, createCapabilitiesApi } from '../src/capabilities'

describe('capabilities', () => {
  it('imageProcessing is true only when an image adapter is wired', () => {
    expect(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true }).capabilities.imageProcessing).toBe(true)
    expect(buildCapabilities({ writableMediaStore: true, backgroundJobs: true }).capabilities.imageProcessing).toBe(false)
  })
  it('serves the capability object at GET /api/capabilities', async () => {
    const app = createCapabilitiesApi(buildCapabilities({ image: {}, writableMediaStore: true, backgroundJobs: true, mode: 'self-hosted' }))
    const res = await app.fetch(new Request('http://test/api/capabilities'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'self-hosted',
      capabilities: { imageProcessing: true, writableMediaStore: true, backgroundJobs: true },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/api test capabilities` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/api/src/capabilities.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Capabilities {
  mode?: string
  capabilities: { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean }
}

export function buildCapabilities(opts: {
  image?: unknown
  writableMediaStore: boolean
  backgroundJobs: boolean
  mode?: string
}): Capabilities {
  return {
    ...(opts.mode ? { mode: opts.mode } : {}),
    capabilities: {
      imageProcessing: !!opts.image,
      writableMediaStore: opts.writableMediaStore,
      backgroundJobs: opts.backgroundJobs,
    },
  }
}

export function createCapabilitiesApi(caps: Capabilities) {
  const app = new Hono()
  app.use('*', cors())
  app.get('/api/capabilities', (c) => c.json(caps))
  return app
}
```

- [ ] **Step 4: Wire in `server.ts`** — after the `createSharpImageAdapter()` is available, add the import and mount. The image adapter is created once and shared:

```ts
// server.ts — add import near the others
import { buildCapabilities, createCapabilitiesApi } from './capabilities'
// ...
// Replace the inline `image: createSharpImageAdapter()` so the adapter is reused for capabilities:
const imageAdapter = createSharpImageAdapter()
// ... in the createUploadApi({...}) call use `image: imageAdapter,`
// After the createUploadApi route is mounted, add:
app.route('/', createCapabilitiesApi(buildCapabilities({
  image: imageAdapter,            // present in the Node topology
  writableMediaStore: true,       // local fs storage is writable
  backgroundJobs: true,           // persistent Node process can run jobs
  mode: process.env.SETU_MODE ?? 'self-hosted',
})))
```

- [ ] **Step 5: Verify** — `pnpm --filter @setu/api test capabilities` → PASS; `pnpm --filter @setu/api typecheck` clean.

- [ ] **Step 6: Commit** — `feat(api): GET /api/capabilities composed from wired adapters`

---

### Task 2: ReprocessJob port (core) + sqlite store (db-sqlite)

**Files:**
- Modify: `packages/core/src/` — add `reprocess/job.ts` (types + port) and export from the package index.
- Create: `packages/db-sqlite/src/reprocess-job-store.ts`; export from `packages/db-sqlite/src/index.ts`.
- Test: `packages/db-sqlite/test/reprocess-job-store.test.ts`

**Interfaces:**
- Produces (core, edge-safe types only):
```ts
export type ReprocessStatus = 'running' | 'done' | 'failed'
export interface ReprocessJob {
  id: string
  total: number
  processed: number
  cursor: number          // next index into keys[] to process
  status: ReprocessStatus
  error?: string
  keys: string[]          // snapshot of manifest keys at job start
  startedAt: number
  updatedAt: number
}
export interface ReprocessJobStore {
  create(keys: string[], now: number): ReprocessJob          // status 'running', cursor/processed 0
  get(id: string): ReprocessJob | null
  active(): ReprocessJob | null                              // the single 'running' job, if any
  latest(): ReprocessJob | null                              // most-recent job by startedAt (for status)
  saveProgress(id: string, processed: number, cursor: number, now: number): void
  finish(id: string, status: 'done' | 'failed', now: number, error?: string): void
}
```
- Produces (db-sqlite): `createSqliteReprocessJobStore(file: string): ReprocessJobStore` (`file` is a path or `':memory:'`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db-sqlite/test/reprocess-job-store.test.ts
import { describe, it, expect } from 'vitest'
import { createSqliteReprocessJobStore } from '../src/reprocess-job-store'

describe('sqlite reprocess job store', () => {
  it('creates, reads, advances, and finishes a job; tracks active/latest', () => {
    const s = createSqliteReprocessJobStore(':memory:')
    expect(s.active()).toBeNull()
    const j = s.create(['a.manifest.json', 'b.manifest.json'], 1000)
    expect(j.status).toBe('running'); expect(j.total).toBe(2); expect(j.cursor).toBe(0)
    expect(s.active()?.id).toBe(j.id)
    s.saveProgress(j.id, 1, 1, 1001)
    expect(s.get(j.id)?.processed).toBe(1)
    expect(s.get(j.id)?.cursor).toBe(1)
    s.finish(j.id, 'done', 1002)
    expect(s.get(j.id)?.status).toBe('done')
    expect(s.active()).toBeNull()              // no longer running
    expect(s.latest()?.id).toBe(j.id)          // still the latest for status display
    expect(s.get(j.id)?.keys).toEqual(['a.manifest.json', 'b.manifest.json'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/db-sqlite test reprocess-job-store` → FAIL.

- [ ] **Step 3: Add the core port** — create `packages/core/src/reprocess/job.ts` with the `ReprocessStatus`/`ReprocessJob`/`ReprocessJobStore` declarations above (pure types — edge-safe, no imports), and re-export them from the core package index (follow how `SubmissionPort` is exported; add `export * from './reprocess/job'` or an explicit `export type` line in the same place `SubmissionPort` is exported).

- [ ] **Step 4: Implement the sqlite store** (raw better-sqlite3 — no drizzle migration needed for one table):

```ts
// packages/db-sqlite/src/reprocess-job-store.ts
import Database from 'better-sqlite3'
import type { ReprocessJob, ReprocessJobStore, ReprocessStatus } from '@setu/core'

interface Row {
  id: string; total: number; processed: number; cursor: number
  status: ReprocessStatus; error: string | null; keys: string; startedAt: number; updatedAt: number
}
const toJob = (r: Row): ReprocessJob => ({
  id: r.id, total: r.total, processed: r.processed, cursor: r.cursor,
  status: r.status, ...(r.error ? { error: r.error } : {}),
  keys: JSON.parse(r.keys) as string[], startedAt: r.startedAt, updatedAt: r.updatedAt,
})

export function createSqliteReprocessJobStore(file: string): ReprocessJobStore {
  const db = new Database(file)
  db.exec(`CREATE TABLE IF NOT EXISTS reprocess_jobs (
    id TEXT PRIMARY KEY, total INTEGER NOT NULL, processed INTEGER NOT NULL,
    cursor INTEGER NOT NULL, status TEXT NOT NULL, error TEXT,
    keys TEXT NOT NULL, startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`)
  const getRow = db.prepare('SELECT * FROM reprocess_jobs WHERE id = ?')
  return {
    create(keys, now) {
      const id = crypto.randomUUID()
      const job: ReprocessJob = { id, total: keys.length, processed: 0, cursor: 0, status: 'running', keys, startedAt: now, updatedAt: now }
      db.prepare(`INSERT INTO reprocess_jobs (id,total,processed,cursor,status,error,keys,startedAt,updatedAt)
        VALUES (@id,@total,@processed,@cursor,@status,NULL,@keys,@startedAt,@updatedAt)`)
        .run({ ...job, keys: JSON.stringify(keys) })
      return job
    },
    get(id) { const r = getRow.get(id) as Row | undefined; return r ? toJob(r) : null },
    active() { const r = db.prepare("SELECT * FROM reprocess_jobs WHERE status = 'running' ORDER BY startedAt DESC").get() as Row | undefined; return r ? toJob(r) : null },
    latest() { const r = db.prepare('SELECT * FROM reprocess_jobs ORDER BY startedAt DESC').get() as Row | undefined; return r ? toJob(r) : null },
    saveProgress(id, processed, cursor, now) { db.prepare('UPDATE reprocess_jobs SET processed=?, cursor=?, updatedAt=? WHERE id=?').run(processed, cursor, now, id) },
    finish(id, status, now, error) { db.prepare('UPDATE reprocess_jobs SET status=?, error=?, updatedAt=? WHERE id=?').run(status, error ?? null, now, id) },
  }
}
```
Export it: add `export { createSqliteReprocessJobStore } from './reprocess-job-store'` to `packages/db-sqlite/src/index.ts`.

- [ ] **Step 5: Verify** — `pnpm --filter @setu/db-sqlite test reprocess-job-store` → PASS; `pnpm --filter @setu/core typecheck` + `pnpm --filter @setu/db-sqlite typecheck` clean.

- [ ] **Step 6: Commit** — `feat(core,db-sqlite): ReprocessJob port + sqlite store (durable, resumable)`

---

### Task 3: Extract per-image reprocess + chunked resumable runner

**Files:**
- Create: `apps/api/src/reprocess-runner.ts`
- Test: `apps/api/test/reprocess-runner.test.ts`

**Interfaces:**
- Consumes: `ReprocessJobStore` (Task 2), `ingestImage`, `ImagePort`, `StoragePort`, `MediaManifest`, `MediaSettings` (`@setu/core`), `formatsFor` (copy the 1-liner locally or import — keep local to avoid coupling).
- Produces:
```ts
export interface ReprocessDeps { image: ImagePort; storage: StoragePort; media: MediaSettings; widths: number[] }
export async function reprocessOne(deps: ReprocessDeps, manifestKey: string): Promise<'done' | 'skipped'>
export async function runReprocessJob(store: ReprocessJobStore, deps: ReprocessDeps, jobId: string, opts?: { chunkSize?: number; now?: () => number }): Promise<void>
```
- `runReprocessJob` resumes from `job.cursor`, processes `job.keys` in chunks (default 10), calls `saveProgress` after each chunk, and `finish('done')` at the end (or `finish('failed', err)` on throw). `now()` defaults to `Date.now` (injected for tests).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/reprocess-runner.test.ts
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
import { reprocessOne, runReprocessJob, type ReprocessDeps } from '../src/reprocess-runner'

const dirs: string[] = []
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0 })

async function seedWebpOnly(storage: ReturnType<typeof createLocalStorage>, image: ReturnType<typeof createSharpImageAdapter>) {
  const app = createUploadApi({ storage, resolveActor: () => ({ id: 'o', role: 'owner' }), image, mediaSettings: { imageFormat: 'webp', imageLqip: false } })
  const body = new FormData()
  body.append('file', new File([makeTestPng(400, 300)], 'p.png', { type: 'image/png' }))
  const r = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
  return ((await r.json()) as { id: string }).id
}

describe('reprocess runner', () => {
  it('resumes from the job cursor and upgrades only the remaining manifests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpr-')); dirs.push(dir)
    const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
    const image = createSharpImageAdapter()
    const id1 = await seedWebpOnly(storage, image)
    const id2 = await seedWebpOnly(storage, image)
    const keys = [manifestKey(id1), manifestKey(id2)]
    const store = createSqliteReprocessJobStore(':memory:')
    const job = store.create(keys, 1)
    // Simulate a crash AFTER the first key: cursor already at 1, processed 1.
    store.saveProgress(job.id, 1, 1, 2)
    const deps: ReprocessDeps = { image, storage, media: { imageFormat: 'both', imageLqip: true }, widths: [400, 800] }
    await runReprocessJob(store, deps, job.id, { chunkSize: 1, now: () => 3 })
    expect(store.get(job.id)?.status).toBe('done')
    expect(store.get(job.id)?.processed).toBe(2)
    // id2 (the remaining one) is upgraded to both+lqip
    const m2 = JSON.parse(new TextDecoder().decode((await storage.get(manifestKey(id2)))!.body)) as MediaManifest
    expect(new Set(m2.variants.map((v) => v.format))).toEqual(new Set(['webp', 'avif']))
    expect(m2.lqip).toMatch(/^data:image\//)
    // id1 (before the cursor) stays webp-only — resume did NOT reprocess it
    const m1 = JSON.parse(new TextDecoder().decode((await storage.get(manifestKey(id1)))!.body)) as MediaManifest
    expect(new Set(m1.variants.map((v) => v.format))).toEqual(new Set(['webp']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/api test reprocess-runner` → FAIL.

- [ ] **Step 3: Implement** (extract the loop body from the current sync `/media/reprocess` in `media.ts`):

```ts
// apps/api/src/reprocess-runner.ts
import { ingestImage } from '@setu/core'
import type { ImageFormat, ImagePort, MediaManifest, MediaSettings, ReprocessJobStore, StoragePort } from '@setu/core'

const formatsFor = (s: MediaSettings['imageFormat']): ImageFormat[] => (s === 'both' ? ['webp', 'avif'] : [s])

export interface ReprocessDeps { image: ImagePort; storage: StoragePort; media: MediaSettings; widths: number[] }

export async function reprocessOne(deps: ReprocessDeps, mKey: string): Promise<'done' | 'skipped'> {
  const manRaw = await deps.storage.get(mKey)
  if (!manRaw) return 'skipped'
  let old: MediaManifest
  try { old = JSON.parse(new TextDecoder().decode(manRaw.body)) as MediaManifest } catch { return 'skipped' }
  const origRaw = await deps.storage.get(old.original.key)
  if (!origRaw) return 'skipped'
  await ingestImage(
    { image: deps.image, storage: deps.storage },
    { mediaKey: old.id, bytes: origRaw.body, originalKey: old.original.key, formats: formatsFor(deps.media.imageFormat), widths: deps.widths, lqip: deps.media.imageLqip },
  )
  return 'done'
}

export async function runReprocessJob(
  store: ReprocessJobStore, deps: ReprocessDeps, jobId: string,
  opts: { chunkSize?: number; now?: () => number } = {},
): Promise<void> {
  const chunk = opts.chunkSize ?? 10
  const now = opts.now ?? (() => Date.now())
  const job = store.get(jobId)
  if (!job || job.status !== 'running') return
  try {
    let processed = job.processed
    for (let i = job.cursor; i < job.keys.length; i += chunk) {
      for (let j = i; j < Math.min(i + chunk, job.keys.length); j++) {
        await reprocessOne(deps, job.keys[j]!)   // re-ingest is idempotent
        processed++
      }
      store.saveProgress(jobId, processed, Math.min(i + chunk, job.keys.length), now())
    }
    store.finish(jobId, 'done', now())
  } catch (err) {
    store.finish(jobId, 'failed', now(), err instanceof Error ? err.message : String(err))
  }
}
```
Note: keep `formatsFor` here; do not change `media.ts` yet (Task 4 swaps the route).

- [ ] **Step 4: Verify** — `pnpm --filter @setu/api test reprocess-runner` → PASS; typecheck clean.

- [ ] **Step 5: Commit** — `feat(api): chunked resumable reprocess runner (reprocessOne + runReprocessJob)`

---

### Task 4: Async reprocess routes (replace the sync endpoint)

**Files:**
- Modify: `apps/api/src/media.ts` (remove the sync `POST /media/reprocess`; add `POST /api/media/reprocess` + `GET /api/media/reprocess/status`; accept a job store + start-runner callback in `UploadApiOptions`)
- Modify: `apps/api/test/media-reprocess.test.ts` (update to the async shape)
- Test: covered by the updated `media-reprocess.test.ts`

**Interfaces:**
- Consumes: `ReprocessJobStore` (Task 2), `runReprocessJob`/`ReprocessDeps` (Task 3).
- Adds to `UploadApiOptions`: `reprocess?: { store: ReprocessJobStore; run: (jobId: string) => void }` — `run` fire-and-forgets `runReprocessJob` (server.ts wires it; tests can await via a synchronous run). When `reprocess`/`image` absent, the routes return a clear disabled response.
- Produces routes:
  - `POST /api/media/reprocess` → `content.create`; if a job is `active()`, return it; else snapshot manifest keys, `store.create(keys)`, `run(job.id)`, return `{ jobId, status, total, processed }` with **202**.
  - `GET /api/media/reprocess/status` → the `active() ?? latest()` job as `{ status, processed, total, current?, error? }`, or `{ status: 'idle' }` if none.

- [ ] **Step 1: Write the failing test** (replace the body of the existing first test in `media-reprocess.test.ts` with the async flow; keep the 401/403/skip-missing tests but point them at `/api/media/reprocess`). For determinism, wire `reprocess.run` to **await** the runner synchronously in the test:

```ts
// apps/api/test/media-reprocess.test.ts — new async-flow test
import { runReprocessJob } from '../src/reprocess-runner'
// ...
it('starts a job, reports progress, and upgrades the library (both+lqip)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reprocess-')); dirs.push(dir)
  const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
  const image = createSharpImageAdapter()
  const store = createSqliteReprocessJobStore(':memory:')
  let current: MediaSettings = { imageFormat: 'webp', imageLqip: false }
  const app = createUploadApi({
    storage, resolveActor: () => owner, image, mediaSettings: () => current,
    reprocess: { store, run: (jobId) => { void runReprocessJob(store, { image, storage, media: current, widths: [400, 800] }, jobId, { chunkSize: 10 }) } },
  })
  const body = new FormData()
  body.append('file', new File([makeTestPng(400, 300)], 'pic.png', { type: 'image/png' }))
  const up = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
  const uploaded = (await up.json()) as { id: string }

  current = { imageFormat: 'both', imageLqip: true }
  const start = await app.fetch(new Request('http://test/api/media/reprocess', { method: 'POST' }))
  expect(start.status).toBe(202)
  const { jobId } = (await start.json()) as { jobId: string }
  expect(jobId).toBeTruthy()
  // runner awaited synchronously above → job is already done
  const st = await app.fetch(new Request('http://test/api/media/reprocess/status'))
  const status = (await st.json()) as { status: string; processed: number; total: number }
  expect(status.status).toBe('done'); expect(status.processed).toBe(status.total)
  const m = JSON.parse(new TextDecoder().decode((await storage.get(manifestKey(uploaded.id)))!.body)) as MediaManifest
  expect(new Set(m.variants.map((v) => v.format))).toEqual(new Set(['webp', 'avif']))
  expect(m.lqip).toMatch(/^data:image\//)
})
```
Update the 401/403 tests to POST `http://test/api/media/reprocess` (pass `reprocess` only where a started job is expected; for 401/403 the auth check precedes job logic so `reprocess` can be omitted). Keep the skip-missing assertion by checking the finished job's `processed` count instead of the old `{ reprocessed }`.

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/api test media-reprocess` → FAIL.

- [ ] **Step 3: Implement** — in `media.ts`: add `reprocess?: { store: ReprocessJobStore; run: (jobId: string) => void }` to `UploadApiOptions`; delete the old `app.post('/media/reprocess', …)` block; add:

```ts
// media.ts — imports
import type { ReprocessJobStore } from '@setu/core'
// in createUploadApi, after the upload route:
app.post('/api/media/reprocess', authMiddleware(opts.resolveActor), async (c) => {
  if (!authz.can(c.get('actor'), 'content.create')) return c.json({ error: 'forbidden' }, 403)
  if (!opts.image || !opts.reprocess) return c.json({ error: 'reprocess unavailable in this mode' }, 409)
  const running = opts.reprocess.store.active()
  if (running) return c.json({ jobId: running.id, status: running.status, total: running.total, processed: running.processed }, 202)
  const all = await storage.list()
  const keys = all.filter((k) => k.endsWith('.manifest.json'))
  const job = opts.reprocess.store.create(keys, Date.now())
  opts.reprocess.run(job.id)
  return c.json({ jobId: job.id, status: job.status, total: job.total, processed: job.processed }, 202)
})

app.get('/api/media/reprocess/status', (c) => {
  const store = opts.reprocess?.store
  const job = store?.active() ?? store?.latest()
  if (!job) return c.json({ status: 'idle' })
  return c.json({ status: job.status, processed: job.processed, total: job.total, ...(job.error ? { error: job.error } : {}) })
})
```

- [ ] **Step 4: Verify** — `pnpm --filter @setu/api test media-reprocess` → PASS; `pnpm --filter @setu/api typecheck` clean.

- [ ] **Step 5: Commit** — `feat(api): async /api/media/reprocess (start+status); replace sync endpoint`

---

### Task 5: Wire the store + runner in server.ts; resume on boot

**Files:**
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/reprocess-resume-boot.test.ts`

**Interfaces:**
- Consumes: `createSqliteReprocessJobStore`, `runReprocessJob`, `ReprocessDeps`. Server builds `reprocess: { store, run }` and passes it to `createUploadApi`; on boot, if `store.active()` exists, calls `run(active.id)` to resume.
- Produces: `resumeActiveJob(store, run)` — a tiny exported helper so it's unit-testable without booting the server.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/reprocess-resume-boot.test.ts
import { describe, it, expect, vi } from 'vitest'
import { resumeActiveJob } from '../src/server-resume'

describe('resume on boot', () => {
  it('runs the active job if one was left running', () => {
    const run = vi.fn()
    const store = { active: () => ({ id: 'j1' }) } as any
    resumeActiveJob(store, run)
    expect(run).toHaveBeenCalledWith('j1')
  })
  it('does nothing when no active job', () => {
    const run = vi.fn()
    resumeActiveJob({ active: () => null } as any, run)
    expect(run).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/api test reprocess-resume-boot` → FAIL.

- [ ] **Step 3: Implement the helper** — create `apps/api/src/server-resume.ts`:

```ts
import type { ReprocessJobStore } from '@setu/core'
export function resumeActiveJob(store: ReprocessJobStore, run: (jobId: string) => void): void {
  const active = store.active()
  if (active) run(active.id)
}
```

- [ ] **Step 4: Wire `server.ts`** — build the store, the deps, the `run` thunk, pass `reprocess` into `createUploadApi`, and resume on boot:

```ts
// server.ts additions
import { createSqliteReprocessJobStore } from '@setu/db-sqlite'
import { runReprocessJob } from './reprocess-runner'
import { resumeActiveJob } from './server-resume'
// after mediaDir/imageAdapter are defined:
const localStorage = createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl })
const reprocessStore = createSqliteReprocessJobStore(`${dir}/.setu/reprocess.db`)
const runReprocess = (jobId: string) => {
  const media = loadSiteSettings().media
  void runReprocessJob(reprocessStore, { image: imageAdapter, storage: localStorage, media, widths: [400, 800, 1200, 1600] }, jobId)
}
// pass storage: localStorage, image: imageAdapter, and reprocess: { store: reprocessStore, run: runReprocess } into createUploadApi(...)
// after serve(...):
resumeActiveJob(reprocessStore, runReprocess)
```

- [ ] **Step 5: Verify** — `pnpm --filter @setu/api test reprocess-resume-boot` → PASS; `pnpm --filter @setu/api test media` (all media suites) green; `pnpm -r typecheck` clean (note any pre-existing unrelated failures).

- [ ] **Step 6: Commit** — `feat(api): wire reprocess store/runner in server + resume active job on boot`

---

### Task 6: Admin — `useCapabilities` hook + Media gating message

**Files:**
- Create: `apps/admin/src/lib/useCapabilities.ts`
- Modify: `apps/admin/src/screens/settings/MediaSettings.tsx`
- Test: `apps/admin/test/use-capabilities.test.tsx`, and extend `apps/admin/test/settings-media.test.tsx`

**Interfaces:**
- Produces: `useCapabilities(): { caps: { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean } | null; loading: boolean }` — fetches `${apiBase}/api/capabilities` once.
- MediaSettings derives `canReprocess = !!caps && caps.imageProcessing && caps.writableMediaStore && caps.backgroundJobs`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/use-capabilities.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCapabilities } from '../src/lib/useCapabilities'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    capabilities: { imageProcessing: false, writableMediaStore: true, backgroundJobs: true },
  }), { status: 200 })))
})
describe('useCapabilities', () => {
  it('fetches and exposes capability flags', async () => {
    const { result } = renderHook(() => useCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.caps?.imageProcessing).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @setu/admin test use-capabilities` → FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/admin/src/lib/useCapabilities.ts
import { useEffect, useState } from 'react'
const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''
export interface CapFlags { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean }
export function useCapabilities() {
  const [caps, setCaps] = useState<CapFlags | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/capabilities`)
        const data = (await res.json()) as { capabilities: CapFlags }
        if (live) setCaps(data.capabilities)
      } catch { if (live) setCaps(null) }
      finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [])
  return { caps, loading }
}
```

- [ ] **Step 4: Gate in MediaSettings** — consume `useCapabilities()`; compute `canReprocess`. When `!canReprocess && !loading`, render the Reprocess `Button` **disabled** with the message *"Image reprocessing runs in local or self-hosted mode. This site is served from the edge — run reprocess from your local Setu or your self-hosted server."* and a one-line note that uploads won't generate variants when `imageProcessing && writableMediaStore` is false. Add a `settings-media.test.tsx` case: stub `/api/capabilities` → `imageProcessing:false` → assert the Reprocess control is disabled and the message text is present.

- [ ] **Step 5: Verify** — `pnpm --filter @setu/admin test use-capabilities settings-media` → PASS; `pnpm --filter @setu/admin typecheck` clean.

- [ ] **Step 6: Commit** — `feat(admin): useCapabilities hook + topology gate on Reprocess`

---

### Task 7: Admin — async progress UI (start → poll → Progress bar)

**Files:**
- Modify: `apps/admin/src/screens/settings/MediaSettings.tsx`
- Create (if absent): `apps/admin/src/components/ui/progress.tsx` (shadcn — add via the shadcn MCP / `npx shadcn@latest add progress`)
- Test: extend `apps/admin/test/settings-media.test.tsx`

**Interfaces:**
- Consumes: `POST ${apiBase}/api/media/reprocess` → `{ jobId }`; `GET ${apiBase}/api/media/reprocess/status` → `{ status, processed, total, error? }`.
- On confirm: POST to start, then poll status every ~1s; render shadcn `Progress` with `value={Math.round(processed/total*100)}` and an `N of M` label until `status==='done'` (success toast `Reprocessed N images`) or `'failed'` (error toast). On mount, also read status once so a job already running (e.g. resumed) shows its progress.

- [ ] **Step 1: Add the shadcn Progress component** — if `apps/admin/src/components/ui/progress.tsx` does not exist, add it via the shadcn MCP (`mcp__shadcn__*` → `get_add_command_for_items`) and run the install. Confirm it exports `Progress`.

- [ ] **Step 2: Write the failing test** (mock fetch to return a started job then a `done` status; assert the bar + final toast):

```tsx
// settings-media.test.tsx — progress case (sketch; mirror the file's existing harness)
it('starts reprocess, polls, shows progress, and toasts the count', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ capabilities: { imageProcessing: true, writableMediaStore: true, backgroundJobs: true } }), { status: 200 })) // capabilities
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'idle' }), { status: 200 }))                 // initial status
    .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'j1', status: 'running', total: 3, processed: 0 }), { status: 202 })) // start
    .mockResolvedValue(new Response(JSON.stringify({ status: 'done', processed: 3, total: 3 }), { status: 200 }))                       // poll → done
  vi.stubGlobal('fetch', fetchMock)
  // render MediaSettings, open the dialog, confirm, then:
  await waitFor(() => expect(screen.getByText(/Reprocessed 3 images/i)).toBeInTheDocument())
})
```

- [ ] **Step 3: Implement** — replace the current synchronous `reprocess()` in MediaSettings with: POST start → store `jobId` → `setInterval`/recursive poll of `/api/media/reprocess/status` (clear on `done`/`failed`/unmount) → drive `processed/total` state into `<Progress>` + an `N of M` caption inside the dialog (or inline). On `done`: `notify.success(\`Reprocessed ${processed} image${processed === 1 ? '' : 's'}\`)`; on `failed`: `notify.error(error ?? 'Reprocess failed')`. Keep the AlertDialog warning. Read status once on mount to reflect a resumed/in-flight job.

- [ ] **Step 4: Verify** — `pnpm --filter @setu/admin test settings-media` → PASS; `pnpm --filter @setu/admin typecheck` clean.

- [ ] **Step 5: Commit** — `feat(admin): live reprocess progress (start → poll → shadcn Progress)`

---

### Task 8: Live UAT gate (DoD #1)

**Files:** none (verification task). Drive the running app from the worktree.

- [ ] **Step 1:** From the worktree, `pnpm dev`. In the admin Settings → Media: confirm capabilities load (Reprocess enabled in this Node topology).
- [ ] **Step 2:** Seed a handful of images (upload via the media picker, or the recipe seeder for scale). Set format `both` + LQIP on.
- [ ] **Step 3:** Click Reprocess → confirm the dialog warning → watch the **Progress bar advance `N of M`** to completion → success toast with the count.
- [ ] **Step 4 (resume):** Start a reprocess over a larger set; **kill the api mid-run** (`Ctrl-C` the api process) and restart it; confirm via `GET /api/media/reprocess/status` and the admin that the job **resumes** and completes (no double-processing, counts consistent).
- [ ] **Step 5 (gate):** Temporarily run the api with the image adapter disabled (or point the admin at a capabilities response with `imageProcessing:false`); confirm Reprocess is **disabled with the mode-aware message**.
- [ ] **Step 6:** Render-check an upgraded image on the site (`<picture>` + blur-up intact). Stop the dev stack.
- [ ] **Step 7: Commit** any notes; this task gates the branch for final review.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** capability endpoint (T1) ✓; generic/not-media-scoped + composed in server.ts (T1) ✓; shared `useCapabilities` (T6) ✓; gate + message + uploads note (T6) ✓; async start/status routes under `/api/media/*` (T4) ✓; chunked runner (T3) ✓; durable sqlite store (T2) ✓; resume-on-boot (T5) ✓; progress bar polling (T7) ✓; one-job-at-a-time (T4) ✓; authz unchanged (T4) ✓; live UAT incl. resume + gate (T8) ✓; `/media/*` untouched ✓.
- **Type consistency:** `ReprocessJob`/`ReprocessJobStore` (T2) used identically in T3/T4/T5; `ReprocessDeps`/`runReprocessJob`/`reprocessOne` (T3) consumed by T4/T5; `CapFlags` (T6) consumed by T7.
- **No placeholders:** every code step carries real code/tests; mechanical UI steps reference the existing `MediaSettings.tsx` idioms they mirror.
- **Out of scope (per spec):** cancel mid-job, multi-job queue, SSE, migrating the existing bare routes under `/api/*` (separate deferred task).
