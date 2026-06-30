# Reprocess — topology-aware, async, resumable — design

Date: 2026-06-30
Status: Draft (decisions agreed in chat); ready for owner review → plan
Owner: Mayank

## Problem / goal

The image wave shipped `POST /media/reprocess` as a **synchronous** request that re-encodes the
whole library and returns a count. Two problems surfaced in UAT:

1. **Topology blindness.** Reprocess (and the upload ingest it shares) runs `sharp` (native libvips)
   + writes a filesystem git repo + local storage — the **Node topology only**. It cannot run on
   Cloudflare Pages/Workers (no native binaries, no fs, ~30s request budget). Today the admin offers
   the button regardless of whether the api it talks to can actually do the work.
2. **No progress, blocks, can't scale.** At ~4000 images on `both`+LQIP (~7 encodes/image ≈ 28k
   encodes, AVIF slow) a single request runs for tens of minutes–hours, risks timeouts/memory, has
   no progress, and can't resume after a crash/restart.

Goal: make Reprocess **capability-gated** (detect + disable with a mode-aware message) and an
**async, chunked, resumable** background job with live progress. This is the first use of a
reusable **topology-capability** seam other Node-only features will share.

## Decisions (agreed in chat, 2026-06-30)

- **Edge / incapable api → detect + disable** the Reprocess control with a clear mode-aware message
  (not hidden, not a button that errors). Uploads hit the same pipeline, so surface the same signal.
- **Async job: progress + chunked + resumable.** Durable job state so a crash/restart resumes where
  it left off. Admin shows a live `N of M` progress bar, not a frozen "Reprocessing…".
- Built now, as its own wave, on top of the merged `image-format-lqip`.

## Architecture

### 1. Capability seam (`apps/api` → admin)

A small **capabilities** endpoint, mirroring the existing `/forms/captcha-status` + admin
`SpamProtectionStatus` pattern (reuse, not a new pattern):

`GET /media/capabilities` → `{ canReprocess: boolean, reason?: string, imageEncoder: 'sharp' | null, writableStore: boolean }`

- `canReprocess` = an image adapter is wired (`opts.image` present) **and** the storage is writable
  (Node/self-hosted topology). On an edge api (future `git-github` topology, no image port) or a
  Node api started without an image adapter, this is `false` with a human `reason`.
- This is the honest "which mode am I in" signal: the admin asks whatever api `VITE_SETU_API`
  points at. A Node/self-hosted api says yes; an edge api says no.

### 2. Admin gating (Settings → Media)

On mount, fetch `/media/capabilities`:
- **canReprocess** → Reprocess enabled, wired to the async job (below).
- **!canReprocess** → Reprocess **disabled** + a message: *"Image reprocessing runs in local or
  self-hosted mode. This site is served from the edge — run reprocess from your local Setu or your
  self-hosted server."* Also show a one-line note that **uploads** won't generate variants in this
  mode (same pipeline).

### 3. Async, chunked, resumable job (`apps/api`)

- `POST /media/reprocess` no longer blocks: it **starts a job** and returns `{ jobId }` (202).
  If a job is already running, return the running job (one job at a time — sufficient; avoids
  concurrent re-encode storms).
- The job processes the manifest-key list (snapshotted at start, stable order) in **chunks** of N
  (e.g. 10), re-ingesting each with current settings (reuses the existing per-image reprocess logic),
  persisting progress after each chunk.
- **Job store** = a tiny durable table via `@setu/db-sqlite` (reuse the submissions DB pattern;
  `.setu/…`): `{ id, total, processed, cursor, status: 'running'|'done'|'failed'|'paused', error?,
  keysSnapshot, startedAt, updatedAt }`. On api restart, a `running` job **resumes** from `cursor`.
- Authz unchanged: `content.create`. Skip-missing-original / skip-corrupt behavior unchanged.

### 4. Progress (admin polls)

- `GET /media/reprocess/status` → the current/last job `{ status, processed, total, current?, error? }`.
- The admin opens the AlertDialog → on confirm, POST starts the job, then **polls** status (~1s) and
  shows a **shadcn `Progress`** bar with `N of M` until `done` (success toast with count) or `failed`
  (error toast). The dialog/section reflects a resumed job on reload too.

## Components & boundaries

- `apps/api/src/media.ts` — `/media/capabilities`; `POST /media/reprocess` → job start; the chunked
  job runner; `GET /media/reprocess/status`.
- `@setu/db-sqlite` (or a small `apps/api` job store) — durable reprocess-job table + resume-on-boot.
- `apps/admin/src/screens/settings/MediaSettings.tsx` — capability fetch + gate/message; progress
  bar + polling; reuse the existing `SpamProtectionStatus`-style fetch.
- `apps/admin/src/components/ui/progress.tsx` — shadcn `Progress` (add via shadcn MCP if absent).

## Testing

- **Capability**: endpoint reports `canReprocess:false` with reason when no image adapter / store;
  `true` when both present. Admin disables + messages when false (component test).
- **Async job**: POST returns a jobId + 202; status transitions running→done; processed reaches total;
  the manifest is upgraded (reuse the both+lqip assertion). One-job-at-a-time enforced.
- **Resumable**: a job persisted mid-run (cursor < total) resumes from the cursor on a fresh api
  instance and completes (no double-processing past the cursor).
- **Admin progress**: polling renders `N of M` and the final toast (component test with a mocked
  status sequence).
- **Live UAT gate (DoD #1)**: run a real reprocess on a seeded library, watch the progress bar
  advance, kill+restart the api mid-run and confirm it resumes; flip the api to an incapable config
  and confirm the button disables with the message.

## Scope

**In:** the capability endpoint + admin gate/message; async single-job reprocess with chunking,
durable resume, and a polled progress bar.

**Out (YAGNI):** multiple concurrent jobs / a queue; multi-worker or distributed processing;
per-image retry/skip UI beyond the count + error; cancel mid-job (could be a fast-follow); applying
the capability gate to every Node-only feature (this wave establishes the seam; others adopt later).

## Risks

- **Long Node process / memory.** Chunking + `withoutEnlargement` bounds peak work; one job at a
  time avoids storms. Keep chunk size conservative; stream, don't accumulate buffers.
- **Resume correctness.** The snapshot+cursor must be stable across restarts; persist cursor only
  after a chunk's writes are committed, so a crash re-does at most one chunk (idempotent — re-ingest
  overwrites the same keys).
- **Polling vs SSE.** Polling is simpler and robust; SSE is a possible later upgrade. Not worth it now.
- Stay within [[setu-engineering-constraints]] — this is explicitly a Node-topology capability; the
  edge path is the *disabled + message*, by design.
