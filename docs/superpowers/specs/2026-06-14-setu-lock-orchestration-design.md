# Design — Draft + Lock Orchestration (`@setu/core`) (Increment #4)

_Date: 2026-06-14 · Status: approved_

## Purpose

Build the first piece of Setu **core logic that consumes the `DataPort`**: the
PRD §9 pessimistic-locking + draft-autosave state machine. This closes the
hexagonal loop (core logic → port → adapter) proven structurally in increment #3.
Pure core logic — no UI, no Node, no Git. Injected `DataPort` + injected clock.

Follows a decision-complete PRD (`plan/prd.md` §9, and §1 "lock orchestration
lives in core") and shipped increments #1–#3.

## Scope

**In:**
- `packages/core/src/authoring/`:
  - `lock-policy.ts` — a pure `evaluateLock(...)` decision function.
  - `authoring-service.ts` — `createAuthoringService(deps)` applying the policy
    through a `DataPort`: `open`, `save`, `release`, `forceUnlock`, `status`.
  - `types.ts` — `AuthoringService` interface, result types, `LockDecision`.
- Export the service + types + `DEFAULT_LOCK_TTL_MS` from `@setu/core`.
- Add `src/authoring` to the core edge-portability guard (`tsconfig.edge.json`).
- Vitest tests: a pure `lock-policy` suite + a service suite using a local
  in-memory fake `DataPort` + a controllable clock.

**Out (explicitly deferred):**
- The base-SHA publish conflict guard and the whole publish pipeline (need
  `GitPort`, a later increment). `Draft.baseSha` is stored already (#3) but not
  yet checked here.
- The editor UI, autosave debouncing, and the takeover-*prompt* UX (UI concerns).
- Any CRDT / real-time co-editing (§9: no Yjs in V1).
- Authentication/authorization (who is `editor`, is the caller an admin) — that
  is resolved by `AuthPort`/the API above this service; `forceUnlock` is the
  *mechanism* only.

## Why this slice / these choices

- **Pure policy + thin service.** The lock decision is a pure function of
  `(lock, editor, now, ttl)`; the service just applies the decision via the port.
  This makes the tricky part (the state machine, TTL boundary) testable with zero
  IO, and keeps the service a small orchestration shell.
- **Injected clock (thunk).** A constructor-injected `now?: () => number`
  (default `() => Date.now()`, which is edge-safe on workerd). Chosen over
  per-call `now` params (keeps `open(ref, editor)` signatures clean) and over a
  `Clock` object (unnecessary ceremony). Tests inject a mutable fake.
- **Lazy contention, no heartbeat (§9).** Freshness (`now - lockedAt > ttl`) is
  computed only when someone interacts with an entry (`open`/`save`/`status`) —
  there is no background timer, honoring the "don't burn edge request quotas"
  rule. Autosave (`save`) *is* the lock refresh.
- **Pessimistic guarantee.** A `save` blocked by another editor's fresh lock
  **does not persist** — the second editor cannot clobber the first.

## Architecture

```
packages/core/src/authoring/
├── types.ts             # AuthoringService, OpenResult, SaveResult, LockStatus,
│                        # LockDecision, LockOutcome, AuthoringDeps
├── lock-policy.ts       # evaluateLock(lock, editor, now, ttlMs): LockDecision  (pure)
└── authoring-service.ts # createAuthoringService(deps): AuthoringService
(+ re-exported from packages/core/src/index.ts)
```

The service depends only on the `DataPort` interface (#3) + a clock — no Node, no
concrete adapter. It is edge-portable and added to the edge guard.

## Types & API

```ts
import type { Draft, DraftInput, EntryRef, Lock } from '../data/types'
import type { DataPort } from '../data/data-port'

/** Default pessimistic-lock TTL: 10 minutes (PRD §9 says ~5-10 min). */
export const DEFAULT_LOCK_TTL_MS = 600_000

/** Pure decision from the current lock state. */
export type LockDecision = 'acquire' | 'refresh' | 'takeover' | 'blocked'

/** Outcome reported to callers (the granted decisions + the blocked case). */
export type LockOutcome = 'acquired' | 'refreshed' | 'tookOver' | 'blocked'

export interface OpenResult {
  /** True unless blocked by another editor's fresh lock. */
  granted: boolean
  outcome: LockOutcome
  /** The caller's lock when granted; the holder's lock when blocked. */
  lock: Lock
  /** The current draft (may be null if none yet). Returned even when blocked,
   *  so a second editor can view read-only. */
  draft: Draft | null
}

export interface SaveResult {
  /** True if the draft was persisted; false if blocked (NOT persisted). */
  saved: boolean
  outcome: LockOutcome
  lock: Lock
  /** The saved draft when saved; the current (unchanged) draft when blocked. */
  draft: Draft | null
}

export interface LockStatus {
  lock: Lock
  /** now - lockedAt > ttl. */
  stale: boolean
}

export interface AuthoringService {
  /** Open an entry for editing: acquire/refresh/takeover the lock or report it
   *  blocked. Returns the current draft (read-only when blocked). */
  open(ref: EntryRef, editor: string): Promise<OpenResult>
  /** Autosave: persist the draft and refresh the lock, unless another editor
   *  holds a fresh lock (then nothing is persisted). `input` carries the ref. */
  save(input: DraftInput, editor: string): Promise<SaveResult>
  /** Release the lock iff the caller holds it. */
  release(ref: EntryRef, editor: string): Promise<{ released: boolean }>
  /** Admin override: delete the lock unconditionally (authz is upstream). */
  forceUnlock(ref: EntryRef): Promise<void>
  /** Read-only lock status for "who's editing" indicators; null if unlocked. */
  status(ref: EntryRef): Promise<LockStatus | null>
}

export interface AuthoringDeps {
  data: DataPort
  /** Defaults to () => Date.now(). */
  now?: () => number
  /** Defaults to DEFAULT_LOCK_TTL_MS. */
  lockTtlMs?: number
}

export function createAuthoringService(deps: AuthoringDeps): AuthoringService
```

## Behavior (the state machine)

`evaluateLock(lock, editor, now, ttlMs)`:

| current lock state                          | decision   |
|---------------------------------------------|------------|
| `null` (no lock)                            | `acquire`  |
| `lockedBy === editor`                       | `refresh`  |
| held by other AND `now - lockedAt > ttlMs`  | `takeover` |
| held by other AND fresh                     | `blocked`  |

Boundary: `now - lockedAt === ttlMs` is **fresh** (strict `>` for staleness).

`open(ref, editor)`:
1. `lock = await data.getLock(ref)`; `decision = evaluateLock(lock, editor, now(), ttl)`.
2. If `blocked` → `{ granted: false, outcome: 'blocked', lock, draft: await data.getDraft(ref) }`.
3. Else → `newLock = { ...ref, lockedBy: editor, lockedAt: now() }`; `await data.putLock(newLock)`;
   `{ granted: true, outcome: map(decision), lock: newLock, draft: await data.getDraft(ref) }`
   where `map`: acquire→`acquired`, refresh→`refreshed`, takeover→`tookOver`.

`save(input, editor)`:
1. `ref = { collection, locale, slug }` from `input`; `lock = await data.getLock(ref)`;
   `decision = evaluateLock(lock, editor, now(), ttl)`.
2. If `blocked` → do NOT persist; `{ saved: false, outcome: 'blocked', lock, draft: await data.getDraft(ref) }`.
3. Else → `await data.putLock({ ...ref, lockedBy: editor, lockedAt: now() })`;
   `saved = await data.saveDraft(input)`;
   `{ saved: true, outcome: map(decision), lock: <the put lock>, draft: saved }`.

`release(ref, editor)`: `lock = getLock(ref)`; if `lock && lock.lockedBy === editor`
→ `deleteLock(ref)`, `{ released: true }`; else `{ released: false }` (never deletes
another editor's lock).

`forceUnlock(ref)`: `await data.deleteLock(ref)` unconditionally; returns void.

`status(ref)`: `lock = getLock(ref)`; `null` if no lock; else
`{ lock, stale: now() - lock.lockedAt > ttl }` (no mutation).

## Error handling

- The service never throws for normal contention — it returns result objects with
  `granted/saved: false`. UX (prompt, read-only banner) is the caller's job.
- `DataPort` errors propagate (a dead DB is a real failure, not a lock outcome).
- `now()` is called once per public method invocation and reused within it, so a
  method's freshness check and its written `lockedAt` are consistent.

## Testing (TDD)

Tests use a **local in-memory fake `DataPort`** (Map-based, ~30 lines, defined in
the test file — no cross-package dependency, no workspace cycle) and a
**controllable clock** (`let clock = 0; const now = () => clock`).

- **`lock-policy` (pure)** — `evaluateLock` returns: `acquire` (null), `refresh`
  (same editor), `takeover` (other + `now-lockedAt > ttl`), `blocked` (other +
  fresh); boundary `now-lockedAt === ttl` → not stale (yields `blocked`/`refresh`,
  not `takeover`).
- **`authoring-service`** —
  - `open` on a free entry → `acquired`, lock written with `lockedAt = now`,
    draft echoed (null if none).
  - `open` by the same editor later → `refreshed`, `lockedAt` advanced to the new
    `now`.
  - `open` by another editor while fresh → `blocked`, `granted: false`, draft
    still returned (read-only), lock is the holder's.
  - `open` by another editor after TTL → `tookOver`, lock now the caller's.
  - `save` when free/held/stale → `saved: true`, draft persisted, lock refreshed.
  - `save` blocked by another fresh editor → `saved: false`, and `getDraft`
    confirms **nothing was persisted**.
  - `release` by the holder → `{ released: true }`, lock gone; `release` by a
    non-holder → `{ released: false }`, lock intact.
  - `forceUnlock` → lock gone regardless of holder.
  - `status` → `null` when unlocked; `{ stale: false }` when fresh;
    `{ stale: true }` after TTL.
  - default TTL is `DEFAULT_LOCK_TTL_MS` when `lockTtlMs` omitted.

## Definition of done

- `pnpm test` green: new `authoring` suites + existing 62 unaffected.
- `pnpm typecheck` clean across packages, including the edge guard now covering
  `src/authoring` (the service must stay Node-free).
- `createAuthoringService`, `AuthoringService`, the result types, and
  `DEFAULT_LOCK_TTL_MS` exported from `@setu/core`.
- Committed via the subagent-driven flow.
