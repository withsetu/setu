# Draft + Lock Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the PRD §9 pessimistic-lock + draft-autosave state machine to `@saytu/core` as a pure service that consumes the `DataPort` — the first core logic to use a port.

**Architecture:** A pure decision function `evaluateLock(lock, editor, now, ttl)` plus a thin `createAuthoringService({ data, now?, lockTtlMs? })` that applies the decision through an injected `DataPort` and injected clock. Methods: `open`, `save`, `release`, `forceUnlock`, `status`. No UI, no Node, no Git — edge-portable.

**Tech Stack:** TypeScript (strict), Vitest. Consumes the existing `DataPort` interface + `Draft`/`Lock`/`EntryRef`/`DraftInput` types from `@saytu/core`.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-lock-orchestration-design.md`

---

## File Structure

```
packages/core/src/authoring/
├── types.ts             # AuthoringService, OpenResult, SaveResult, LockStatus,
│                        # LockDecision, LockOutcome, AuthoringDeps, DEFAULT_LOCK_TTL_MS
├── lock-policy.ts       # evaluateLock(...)  (pure)
└── authoring-service.ts # createAuthoringService(deps)
packages/core/src/index.ts        # + re-export the authoring surface
packages/core/tsconfig.edge.json  # + "src/authoring" in include (must stay Node-free)
packages/core/test/authoring/
├── lock-policy.test.ts            # pure decision tests
└── authoring-service.test.ts      # service tests (local fake DataPort + clock)
```

---

### Task 1: Types + pure `evaluateLock` policy

**Files:**
- Create: `packages/core/src/authoring/types.ts`
- Create: `packages/core/src/authoring/lock-policy.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tsconfig.edge.json`
- Test: `packages/core/test/authoring/lock-policy.test.ts`

- [ ] **Step 1: Create the types**

Create `packages/core/src/authoring/types.ts`:

```ts
import type { Draft, DraftInput, EntryRef, Lock } from '../data/types'
import type { DataPort } from '../data/data-port'

/** Default pessimistic-lock TTL: 10 minutes (PRD §9 says ~5-10 min). */
export const DEFAULT_LOCK_TTL_MS = 600_000

/** Pure decision derived from the current lock state. */
export type LockDecision = 'acquire' | 'refresh' | 'takeover' | 'blocked'

/** Outcome reported to callers (granted decisions + the blocked case). */
export type LockOutcome = 'acquired' | 'refreshed' | 'tookOver' | 'blocked'

export interface OpenResult {
  /** True unless blocked by another editor's fresh lock. */
  granted: boolean
  outcome: LockOutcome
  /** The caller's lock when granted; the holder's lock when blocked. */
  lock: Lock
  /** Current draft (null if none); returned even when blocked (read-only view). */
  draft: Draft | null
}

export interface SaveResult {
  /** True if persisted; false if blocked (nothing was written). */
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
  open(ref: EntryRef, editor: string): Promise<OpenResult>
  save(input: DraftInput, editor: string): Promise<SaveResult>
  release(ref: EntryRef, editor: string): Promise<{ released: boolean }>
  forceUnlock(ref: EntryRef): Promise<void>
  status(ref: EntryRef): Promise<LockStatus | null>
}

export interface AuthoringDeps {
  data: DataPort
  /** Defaults to () => Date.now(). */
  now?: () => number
  /** Defaults to DEFAULT_LOCK_TTL_MS. */
  lockTtlMs?: number
}
```

- [ ] **Step 2: Write the failing test for `evaluateLock`**

Create `packages/core/test/authoring/lock-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateLock } from '../../src/authoring/lock-policy'
import type { Lock } from '../../src/index'

const lock = (lockedBy: string, lockedAt: number): Lock => ({
  collection: 'post',
  locale: 'en',
  slug: 'x',
  lockedBy,
  lockedAt,
})
const TTL = 1000

describe('evaluateLock', () => {
  it('acquires when there is no lock', () => {
    expect(evaluateLock(null, 'a@x.com', 5000, TTL)).toBe('acquire')
  })
  it('refreshes when the same editor holds it', () => {
    expect(evaluateLock(lock('a@x.com', 4500), 'a@x.com', 5000, TTL)).toBe('refresh')
  })
  it('takes over when another editor holds a stale lock', () => {
    // age 2000 > ttl 1000
    expect(evaluateLock(lock('b@x.com', 3000), 'a@x.com', 5000, TTL)).toBe('takeover')
  })
  it('blocks when another editor holds a fresh lock', () => {
    // age 500 <= ttl 1000
    expect(evaluateLock(lock('b@x.com', 4500), 'a@x.com', 5000, TTL)).toBe('blocked')
  })
  it('treats age === ttl as fresh (not a takeover)', () => {
    // age exactly 1000, strict > means not stale
    expect(evaluateLock(lock('b@x.com', 4000), 'a@x.com', 5000, TTL)).toBe('blocked')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- lock-policy`
Expected: FAIL — `evaluateLock` module/export missing.

- [ ] **Step 4: Implement `evaluateLock`**

Create `packages/core/src/authoring/lock-policy.ts`:

```ts
import type { Lock } from '../data/types'
import type { LockDecision } from './types'

/** Decide what to do with an entry's lock for `editor` at time `now`. Pure (no
 *  IO). Staleness uses a strict `>` so `now - lockedAt === ttlMs` is still fresh. */
export function evaluateLock(
  lock: Lock | null,
  editor: string,
  now: number,
  ttlMs: number,
): LockDecision {
  if (lock === null) return 'acquire'
  if (lock.lockedBy === editor) return 'refresh'
  if (now - lock.lockedAt > ttlMs) return 'takeover'
  return 'blocked'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @saytu/core test -- lock-policy`
Expected: PASS (5 tests).

- [ ] **Step 6: Export the types surface from the package index**

Edit `packages/core/src/index.ts` — append:

```ts
export type {
  AuthoringService,
  OpenResult,
  SaveResult,
  LockStatus,
  LockDecision,
  LockOutcome,
  AuthoringDeps,
} from './authoring/types'
export { DEFAULT_LOCK_TTL_MS } from './authoring/types'
```

- [ ] **Step 7: Add `src/authoring` to the edge-portability guard**

Edit `packages/core/tsconfig.edge.json` — change the `include` array to:

```json
  "include": ["src/markdoc", "src/data", "src/authoring"]
```

- [ ] **Step 8: Typecheck (incl. edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean — both the main check and the edge guard (the types + pure policy are Node-free).

- [ ] **Step 9: Run the full core suite**

Run: `pnpm --filter @saytu/core test`
Expected: PASS — 44 tests (39 prior + 5 new).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/authoring/types.ts packages/core/src/authoring/lock-policy.ts packages/core/src/index.ts packages/core/tsconfig.edge.json packages/core/test/authoring/lock-policy.test.ts
git commit -m "feat(core): lock-policy (evaluateLock) + authoring types"
```

---

### Task 2: `createAuthoringService`

**Files:**
- Create: `packages/core/src/authoring/authoring-service.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/authoring/authoring-service.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/core/test/authoring/authoring-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createAuthoringService, DEFAULT_LOCK_TTL_MS } from '../../src/index'
import type { DataPort, Draft, EntryRef, Lock, TiptapDoc } from '../../src/index'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`
const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Minimal in-memory DataPort for testing the service (no cross-package dep). */
function fakeDataPort(): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  return {
    async getDraft(ref) {
      return drafts.get(key(ref)) ?? null
    },
    async saveDraft(input) {
      const k = key(input)
      const existing = drafts.get(k)
      const d: Draft = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
        content: input.content,
        metadata: input.metadata,
        baseSha: input.baseSha ?? null,
        createdAt: existing?.createdAt ?? 0,
        updatedAt: 0,
      }
      drafts.set(k, d)
      return d
    },
    async deleteDraft(ref) {
      drafts.delete(key(ref))
    },
    async listDrafts(filter) {
      const all = [...drafts.values()]
      return filter?.collection ? all.filter((d) => d.collection === filter.collection) : all
    },
    async getLock(ref) {
      return locks.get(key(ref)) ?? null
    },
    async putLock(lock) {
      locks.set(key(lock), { ...lock })
    },
    async deleteLock(ref) {
      locks.delete(key(ref))
    },
    async close() {},
  }
}

describe('createAuthoringService', () => {
  let data: DataPort
  let clock: number
  const now = () => clock
  const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'hello' }
  const svc = () => createAuthoringService({ data, now, lockTtlMs: 1000 })

  beforeEach(() => {
    data = fakeDataPort()
    clock = 5000
  })

  it('open on a free entry acquires the lock', async () => {
    const r = await svc().open(ref, 'a@x.com')
    expect(r).toMatchObject({ granted: true, outcome: 'acquired' })
    expect(r.lock).toEqual({ ...ref, lockedBy: 'a@x.com', lockedAt: 5000 })
    expect(r.draft).toBeNull()
  })

  it('open by the same editor later refreshes and advances lockedAt', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com')
    clock = 5400
    const r = await s.open(ref, 'a@x.com')
    expect(r.outcome).toBe('refreshed')
    expect(r.lock.lockedAt).toBe(5400)
  })

  it('open by another editor while fresh is blocked and returns the draft read-only', async () => {
    const s = svc()
    await s.save({ ...ref, content: doc('hi'), metadata: {} }, 'a@x.com')
    clock = 5500 // age 500 <= ttl 1000 → fresh
    const r = await s.open(ref, 'b@x.com')
    expect(r.granted).toBe(false)
    expect(r.outcome).toBe('blocked')
    expect(r.lock.lockedBy).toBe('a@x.com')
    expect(r.draft?.content).toEqual(doc('hi'))
  })

  it('open by another editor after TTL takes over', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com') // locked at 5000
    clock = 6001 // age 1001 > 1000
    const r = await s.open(ref, 'b@x.com')
    expect(r.outcome).toBe('tookOver')
    expect(r.lock.lockedBy).toBe('b@x.com')
  })

  it('save persists the draft and refreshes the lock', async () => {
    const r = await svc().save({ ...ref, content: doc('v1'), metadata: { title: 'T' } }, 'a@x.com')
    expect(r.saved).toBe(true)
    expect(r.draft?.content).toEqual(doc('v1'))
    expect(await data.getLock(ref)).toMatchObject({ lockedBy: 'a@x.com', lockedAt: 5000 })
  })

  it('save blocked by another fresh editor does NOT persist', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com') // a holds a fresh lock at 5000
    clock = 5200
    const r = await s.save({ ...ref, content: doc('intruder'), metadata: {} }, 'b@x.com')
    expect(r.saved).toBe(false)
    expect(r.outcome).toBe('blocked')
    expect(await data.getDraft(ref)).toBeNull() // nothing was written
  })

  it('release by the holder removes the lock; by a non-holder does not', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com')
    expect(await s.release(ref, 'b@x.com')).toEqual({ released: false })
    expect(await data.getLock(ref)).not.toBeNull()
    expect(await s.release(ref, 'a@x.com')).toEqual({ released: true })
    expect(await data.getLock(ref)).toBeNull()
  })

  it('forceUnlock removes the lock regardless of holder', async () => {
    const s = svc()
    await s.open(ref, 'a@x.com')
    await s.forceUnlock(ref)
    expect(await data.getLock(ref)).toBeNull()
  })

  it('status reports null / fresh / stale', async () => {
    const s = svc()
    expect(await s.status(ref)).toBeNull()
    await s.open(ref, 'a@x.com') // locked at 5000
    clock = 5500
    expect(await s.status(ref)).toEqual({
      lock: { ...ref, lockedBy: 'a@x.com', lockedAt: 5000 },
      stale: false,
    })
    clock = 6001
    expect((await s.status(ref))?.stale).toBe(true)
  })

  it('defaults lockTtlMs to DEFAULT_LOCK_TTL_MS', async () => {
    const s = createAuthoringService({ data, now })
    await s.open(ref, 'a@x.com') // locked at 5000
    clock = 5000 + DEFAULT_LOCK_TTL_MS // age === ttl → fresh
    expect((await s.status(ref))?.stale).toBe(false)
    clock = 5000 + DEFAULT_LOCK_TTL_MS + 1 // age > ttl → stale
    expect((await s.status(ref))?.stale).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- authoring-service`
Expected: FAIL — `createAuthoringService` is not exported.

- [ ] **Step 3: Implement the service**

Create `packages/core/src/authoring/authoring-service.ts`:

```ts
import type { EntryRef } from '../data/types'
import type {
  AuthoringDeps,
  AuthoringService,
  LockDecision,
  LockOutcome,
} from './types'
import { DEFAULT_LOCK_TTL_MS } from './types'
import { evaluateLock } from './lock-policy'

const outcomeFor = (decision: Exclude<LockDecision, 'blocked'>): LockOutcome =>
  decision === 'acquire' ? 'acquired' : decision === 'refresh' ? 'refreshed' : 'tookOver'

/** Draft + pessimistic-lock orchestration over a DataPort (PRD §9). */
export function createAuthoringService(deps: AuthoringDeps): AuthoringService {
  const { data } = deps
  const now = deps.now ?? (() => Date.now())
  const ttl = deps.lockTtlMs ?? DEFAULT_LOCK_TTL_MS

  return {
    async open(ref, editor) {
      const t = now()
      const existing = await data.getLock(ref)
      const decision = evaluateLock(existing, editor, t, ttl)
      const draft = await data.getDraft(ref)
      if (decision === 'blocked') {
        // 'blocked' is only returned when a lock exists (held by another, fresh).
        return { granted: false, outcome: 'blocked', lock: existing!, draft }
      }
      const lock = { ...ref, lockedBy: editor, lockedAt: t }
      await data.putLock(lock)
      return { granted: true, outcome: outcomeFor(decision), lock, draft }
    },

    async save(input, editor) {
      const t = now()
      const ref: EntryRef = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
      }
      const existing = await data.getLock(ref)
      const decision = evaluateLock(existing, editor, t, ttl)
      if (decision === 'blocked') {
        return { saved: false, outcome: 'blocked', lock: existing!, draft: await data.getDraft(ref) }
      }
      const lock = { ...ref, lockedBy: editor, lockedAt: t }
      await data.putLock(lock)
      const draft = await data.saveDraft(input)
      return { saved: true, outcome: outcomeFor(decision), lock, draft }
    },

    async release(ref, editor) {
      const existing = await data.getLock(ref)
      if (existing && existing.lockedBy === editor) {
        await data.deleteLock(ref)
        return { released: true }
      }
      return { released: false }
    },

    async forceUnlock(ref) {
      await data.deleteLock(ref)
    },

    async status(ref) {
      const lock = await data.getLock(ref)
      if (lock === null) return null
      return { lock, stale: now() - lock.lockedAt > ttl }
    },
  }
}
```

- [ ] **Step 4: Export the service**

Edit `packages/core/src/index.ts` — add below the `DEFAULT_LOCK_TTL_MS` export:

```ts
export { createAuthoringService } from './authoring/authoring-service'
```

- [ ] **Step 5: Run the service test**

Run: `pnpm --filter @saytu/core test -- authoring-service`
Expected: PASS (10 tests).

- [ ] **Step 6: Typecheck (incl. edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean — the service is Node-free (uses `Date.now`, an ES global, not a Node API), so it passes the edge guard now covering `src/authoring`.

- [ ] **Step 7: Full repo verification (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: every package green — `@saytu/core` now 54 (39 prior + 5 lock-policy + 10 service), `@saytu/db-testing` 11, `@saytu/db-sqlite` 12; typecheck clean across all packages incl. the core edge guard.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/authoring/authoring-service.ts packages/core/src/index.ts packages/core/test/authoring/authoring-service.test.ts
git commit -m "feat(core): createAuthoringService — draft + lock orchestration on DataPort"
```

---

## Self-Review

**Spec coverage:**
- `lock-policy.ts` pure `evaluateLock` (acquire/refresh/takeover/blocked, strict-`>` TTL boundary) → Task 1. ✓
- `types.ts` (AuthoringService, OpenResult, SaveResult, LockStatus, LockDecision, LockOutcome, AuthoringDeps, DEFAULT_LOCK_TTL_MS) → Task 1. ✓
- `createAuthoringService` with `open`/`save`/`release`/`forceUnlock`/`status` → Task 2. ✓
- Injected clock (`now?` default `Date.now`), `lockTtlMs?` default 600_000 → Task 2 Step 3 + the default-TTL test. ✓
- `now()` called once per method and reused (consistent freshness check + written lockedAt) → Task 2 Step 3 (`const t = now()`). ✓
- save-blocked-does-not-persist → Task 2 test "save blocked … does NOT persist". ✓
- read-only draft on blocked open → Task 2 test. ✓
- release only by holder; forceUnlock unconditional; status null/fresh/stale → Task 2 tests. ✓
- Edge guard covers `src/authoring`; Node-free → Task 1 Step 7 + Task 2 Step 6. ✓
- Exports (`createAuthoringService`, types, `DEFAULT_LOCK_TTL_MS`) → Tasks 1 & 2. ✓
- Existing 62 tests stay green (core 39 → 54; db-testing 11; db-sqlite 12 = 77 total) → Task 2 Step 7. ✓
- Deferred (base-SHA publish guard, publish pipeline, editor UI, CRDT) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `evaluateLock(lock, editor, now, ttlMs): LockDecision` is defined in Task 1 and called identically in Task 2. `outcomeFor` takes `Exclude<LockDecision, 'blocked'>` and returns `LockOutcome`. `AuthoringDeps`/`AuthoringService`/`OpenResult`/`SaveResult`/`LockStatus` are defined in Task 1 and implemented in Task 2 with matching shapes. `now`/`ttl`/`lockTtlMs`/`DEFAULT_LOCK_TTL_MS` names are consistent. The fake `DataPort` implements every method of the real interface (getDraft/saveDraft/deleteDraft/listDrafts/getLock/putLock/deleteLock/close). ✓
