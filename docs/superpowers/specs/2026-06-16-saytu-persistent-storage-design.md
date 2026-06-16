# Design — Persistent in-browser storage (IndexedDB)

_Date: 2026-06-16 · Status: approved (converged in UAT discussion)_

## Purpose

Stop the admin from losing work on reload. Today `apps/saytu-admin` runs the in-memory
adapters (`db-memory` + `git-memory`), rebuilt fresh and re-seeded with sample content on
every page load — so a reload wipes every edit. This increment backs the **`DataPort`**
(drafts + locks) and the **`GitPort`** working set with **IndexedDB**, so a reload restores
exactly what you left. It slots in **behind the existing ports — no `@saytu/core` engine
changes** (the point of ports & adapters). This is the *browser* persistence path; the Node
`db-sqlite`/`git-local` "local mode" is separate and deferred (topology note).

## Key context (verified)

- The ports are already **async** (return Promises) and `db-memory` uses `structuredClone` +
  `Date.now()` — so IndexedDB (async, structured-clone storage) drops in behind the same
  behavioral contracts with no interface change.
- Both **contract suites exist**: `runDataPortContract` (`@saytu/db-testing`) and
  `runGitPortContract` (`@saytu/git-testing`). New adapters must pass them.
- **`idb`** 8.0.3 — ISC, dependency-free, tiny — the de-facto IndexedDB promise wrapper
  (raw IndexedDB is verbose and error-prone). **`fake-indexeddb`** 6.2.5 — Apache-2.0, no prod
  deps — in-memory IndexedDB for Vitest/Node (jsdom has no IndexedDB).

## Design decision: tested == shipped (no divergent path)

The new logic this increment introduces is the **async bootstrap + seed-on-empty**. That
logic must be the *same code the app ships*, not a test-only variant. So:

- A single **adapter-agnostic `bootstrapServices(data, git)`** assembles the services bundle
  and runs **seed-only-if-empty**. The app calls it with the **idb** adapters; tests call it
  with the **in-memory** adapters. Only the plugged-in adapter differs — exactly what the
  ports make swappable.
- The **idb adapters** are proven independently by the **contract suites** + a **persistence
  round-trip** test (reopen the same DB name → data restored).
- Existing **component** tests (editor/deploy/content-list) keep injecting the fast in-memory
  adapter — correct (they test component behavior, not storage), not a divergence.

Net: the only test↔production difference is which adapter is plugged in. Nothing real goes
untested. (This corrects an earlier "leave `createServices` in-memory + separate idb path in
`main.tsx`" idea, which would have left the shipped wiring untested.)

## Scope

**In:**

1. **`@saytu/db-idb`** — `createIdbDataPort(dbName?)`: IndexedDB-backed `DataPort` (object
   stores for `drafts` + `locks`, same NUL composite key as db-memory). Async; structured-clone
   value semantics (IndexedDB stores/returns clones natively). Passes `runDataPortContract`.
2. **`@saytu/git-idb`** — `createIdbGitPort(dbName?)`: IndexedDB-backed `GitPort` (a `files`
   store `path→content` + a `meta` store for the head sha and a commit counter). `list(prefix)`
   filters the file keys; `commitFile` writes the file and advances a deterministic head sha
   (same FNV-1a/counter scheme as git-memory, but the counter is persisted in `meta`). Passes
   `runGitPortContract`.
3. **`bootstrapServices(data, git)`** in `apps/saytu-admin/src/data/store.tsx` — assembles
   `servicesFor(data, git)` and seeds the sample drafts **only when the store is empty**
   (no drafts *and* no Git head). Returns `Promise<Services>`.
4. **Async app bootstrap** in `main.tsx` — open the idb adapters, `await bootstrapServices(...)`,
   render the app; show a brief "Loading…" first paint while the DBs open. This is the only
   place the idb adapters are chosen.
5. **Dev-only "Reset to sample content"** — gated behind **`import.meta.env.DEV`** (Vite
   dead-code-eliminates it from production): clears both idb databases and re-seeds. A small
   affordance in the app chrome (dev builds only).
6. Both adapters use **`idb`**; **`fake-indexeddb`** is a devDep for the contract/round-trip
   tests.

**Out (deferred):**

- Node "local mode" (`db-sqlite` / `git-local`) — separate path (topology note).
- Schema migrations / versioned upgrades beyond the initial object-store creation (single
  version 1; a `upgrade` hook creates the stores). Real migration tooling is later.
- Cross-tab sync, storage-quota UX, export/import of the IndexedDB data.
- Seeding/committing sample content into Git (seeds are drafts only, matching today; Git fills
  as the user publishes).

## Architecture / components

```
packages/db-idb/                 # NEW package (mirrors db-memory shape)
├── package.json                 # deps: @saytu/core, idb; devDeps: db-testing, fake-indexeddb, vitest, ts
├── src/{index.ts, adapter.ts}   # createIdbDataPort(dbName?)
└── test/contract.test.ts        # runDataPortContract + persistence round-trip
packages/git-idb/                # NEW package (mirrors git-memory shape)
├── package.json                 # deps: @saytu/core, idb; devDeps: git-testing, fake-indexeddb, vitest, ts
├── src/{index.ts, adapter.ts}   # createIdbGitPort(dbName?)
└── test/contract.test.ts        # runGitPortContract + persistence round-trip + seed test
apps/saytu-admin/
├── package.json                 # + @saytu/db-idb, @saytu/git-idb
├── src/data/store.tsx           # + bootstrapServices(data, git): Promise<Services>; seedIfEmpty
├── src/data/reset.ts            # NEW (dev) — resetToSampleContent(): clear idb + reseed
├── src/main.tsx                 # async bootstrap with idb adapters + loading state
└── test/bootstrap.test.tsx      # seed-on-empty logic via bootstrapServices + in-memory adapters
```

- **`createIdbDataPort(dbName = 'saytu-data')`** — `openDB(dbName, 1, { upgrade })` creates the
  `drafts` and `locks` stores. Methods map directly: `getDraft`→`get`, `saveDraft`→`put`
  (upsert, assigns `createdAt`/`updatedAt` like db-memory), `deleteDraft`→`delete`,
  `listDrafts`→`getAll` (+ collection filter), lock methods similarly, `close`→`db.close()`.
- **`createIdbGitPort(dbName = 'saytu-git')`** — stores `files` (`path→content`) + `meta`
  (`head`, `counter`). `headSha`/`readFile`/`commitFile`/`list` implemented over those stores;
  `commitFile` advances the counter + recomputes the head sha (deterministic, no Date/random).
- **`bootstrapServices(data, git)`** — `const services = servicesFor(data, git); await
  seedIfEmpty(services); return services`. `seedIfEmpty` = if `(await data.listDrafts()).length
  === 0 && (await git.headSha()) === null`, `saveDraft` each `seedDraft`.
- **`main.tsx`** — opens `createIdbDataPort()` + `createIdbGitPort()`, `await
  bootstrapServices`, renders inside `<ServicesProvider services={...}>` (replacing
  `<DataProvider adapter={createAppDataPort()}>`); a loading state covers the await.
- **`resetToSampleContent()`** (dev) — `indexedDB.deleteDatabase` both DBs (or clear the
  stores) + re-seed, then reload. Invoked only from a dev-gated control.

## Seed semantics (the agreed behavior)

- **Empty store (first run, or after a reset)** → seed the 3 sample drafts so the demo is
  populated.
- **Populated store (any later load)** → restore as-is; **never re-seed**, so edits are never
  clobbered. ("Empty" = no drafts AND no Git head; publishing content keeps it non-empty.)
- **Dev reset** → deliberately wipes + re-seeds (dev builds only).

## Error handling / edge cases

- **IndexedDB unavailable / open fails** (private mode, quota, disabled) → `main.tsx` catches,
  logs, and falls back to the in-memory adapters (the app still works for the session, just
  non-persistent) rather than white-screening. Surface a non-blocking notice.
- **Concurrent writes** — autosave is single-in-flight already; IndexedDB transactions are
  atomic per call. No extra locking needed for the single-tab demo.
- **Value semantics** — IndexedDB structured-clones on write/read, so returned objects are
  already isolated from internal state (matches db-memory's `structuredClone` guarantee);
  `TiptapDoc`/metadata are plain JSON, fully cloneable.
- **`close()`** — closes the idb connection; the app keeps one long-lived connection.

## Accessibility

- The bootstrap "Loading…" state is a labeled `role="status"` region; first interactive paint
  follows immediately after the DBs open (sub-second). No keyboard traps; the dev reset control
  (dev only) is a real button.

## Testing (behavior)

- **`db-idb`** passes `runDataPortContract` (via `fake-indexeddb`); plus a **round-trip**: write
  a draft, close, reopen the *same* `dbName`, read it back → present. (Proves persistence, the
  whole point.)
- **`git-idb`** passes `runGitPortContract` (via `fake-indexeddb`); plus a round-trip: commit a
  file, reopen → `readFile`/`list`/`headSha` reflect it.
- **`bootstrapServices` seed logic** (via in-memory adapters — same shipped code): empty store →
  the 3 samples are seeded; a populated store (pre-saved draft) → **not** re-seeded (sample
  slugs absent / existing draft untouched).
- Existing core/db/git/admin suites stay green. `verbatimModuleSyntax` (`import type`) +
  `noUncheckedIndexedAccess` clean. Build keeps fonts + stays jiti-free; the dev reset is absent
  from the production bundle (`import.meta.env.DEV` eliminated).

## Definition of done

- `pnpm --filter @saytu/db-idb test` + `@saytu/git-idb test` (contract + round-trip) green;
  `pnpm --filter @saytu/admin test` (bootstrap seed test + existing) green; `pnpm -r typecheck`
  clean; `pnpm --filter @saytu/admin build` OK (no dev reset in the bundle).
- `pnpm dev`: create/edit content → **reload → it's still there**. First-ever run shows the
  samples; later loads restore your work, never re-seeding. The dev "Reset to sample content"
  wipes + reseeds.
- Built test-first via the subagent-driven flow.

## Note on scope

Two new adapter packages (each tiny, contract-tested), one shared async bootstrap (tested with
the in-memory adapter), the `main.tsx` wiring + loading state, and a dev-only reset. Decomposed
into tight TDD tasks in the plan: (1) `db-idb`, (2) `git-idb`, (3) `bootstrapServices` +
seed-if-empty, (4) `main.tsx` async wiring + loading + dev reset. No engine changes; `idb`
(ISC) + `fake-indexeddb` (Apache-2.0, dev) the only new deps.
