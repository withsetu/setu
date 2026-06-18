# Design — DataPort + `db-sqlite` adapter + contract suite (Increment #3)

_Date: 2026-06-14 · Status: approved_

## Purpose

Stand up Setu's **first hexagonal Port & Adapter**: the `DataPort` interface
(in `@setu/core`), a reusable **port contract test suite** (`@setu/db-testing`),
and a concrete **`db-sqlite`** adapter (Drizzle + better-sqlite3) that passes the
contract. This establishes the pattern every later port (Storage, Auth, Email,
Image, Git) and adapter (`db-d1`) will copy.

Follows a decision-complete PRD (`plan/prd.md`) and shipped increments #1
(Markdoc round-trip) and #2 (`setu.config.ts` schema/parser).

## Scope

**First DataPort slice = the live authoring store (drafts + locks).**

Of the three DataPort surfaces named in PRD §1 (content index/FTS5 search,
drafts, locks), only **drafts + locks** are self-contained today and directly
needed by the near-future editor. The content index and search are deferred
because they need a *producer* (the Git publish/reindex pipeline) and a
*consumer* (SSR/admin search), neither of which exists yet.

**In:**
- `DataPort` interface + domain types (`EntryRef`, `Draft`, `DraftInput`, `Lock`)
  in `@setu/core` (`src/data/`). Pure types/interface — no DB, no test deps.
- `@setu/db-testing` — a new package exporting `runDataPortContract(makeAdapter)`,
  a Vitest battery that asserts the behavioral contract for any DataPort adapter.
- `@setu/db-sqlite` — a new adapter package: Drizzle ORM + Drizzle Kit +
  better-sqlite3, a `drafts` + `locks` schema, migrations applied on init, and a
  test file that runs `runDataPortContract` against an in-memory adapter.

**Out (explicitly deferred):**
- Content index (`db.get`, `db.query`) and FTS5 search — no producer/consumer yet.
- Lock **TTL/acquire/refresh/release orchestration** — per §1 core owns lock
  orchestration; the port stays thin (storage CRUD), policy lands in core when
  the editor consumes it (with an injected clock).
- Users/sessions (Better Auth owns these, §17) and form submissions (form handler).
- The `db-d1` (Cloudflare D1) adapter — it will reuse this schema + contract.
- Publish pipeline, redirects, reindex.

## Why this slice / these choices

- **Thin port, async surface.** The interface returns Promises so the *same*
  contract fits the async D1 adapter later, even though better-sqlite3 is
  synchronous. The port is storage CRUD only; policy (lock TTL, base-SHA publish
  guard) is core logic for a later increment — per §1's "draft/lock orchestration
  lives in core."
- **Drizzle now, not raw SQL.** PRD §2 already chose Drizzle + Drizzle Kit. The
  schema is the durable artifact `db-d1` shares (Drizzle's `sqlite-core` table DSL
  is identical for better-sqlite3 and D1 dialects), so doing it raw then migrating
  is work the PRD rejected. The contract suite keeps the adapter honest regardless
  of internals.
- **better-sqlite3 driver.** Mature, synchronous, first-class Drizzle support;
  the conventional T1 (local) / T3 (VPS) choice. Added to
  `pnpm.onlyBuiltDependencies` so pnpm builds its native binding. (`node:sqlite`
  is built-in but experimental; better-sqlite3 is the reliable choice for now.)
- **Contract suite as its own package.** Keeps Vitest out of `@setu/core`'s
  dependency graph while delivering "one suite, many adapters."

## Architecture

```
packages/core/src/data/
├── types.ts        # EntryRef, Draft, DraftInput, Lock
└── data-port.ts    # DataPort interface
(+ re-exported from packages/core/src/index.ts)

packages/db-testing/            # @setu/db-testing (private; Vitest dep)
├── package.json
├── tsconfig.json
└── src/index.ts                # runDataPortContract(makeAdapter)

packages/db-sqlite/             # @setu/db-sqlite
├── package.json                # drizzle-orm, drizzle-kit, better-sqlite3
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── schema.ts               # Drizzle sqlite-core: drafts, locks
│   ├── adapter.ts              # createSqliteAdapter(file): DataPort
│   └── index.ts                # public surface
├── drizzle/                    # generated migration(s)
└── test/contract.test.ts       # runDataPortContract(() => createSqliteAdapter(':memory:'))
```

## Domain types & interface (`@setu/core`)

```ts
import type { TiptapDoc } from '../markdoc/types'

/** Entry identity (PRD §3): one entry per (collection, locale, slug). */
export interface EntryRef {
  collection: string
  locale: string
  slug: string
}

/** A live draft — the editor's working state, stored in the DB (never Git). */
export interface Draft extends EntryRef {
  /** Live editor content as Tiptap JSON; compiles to Markdoc on publish. */
  content: TiptapDoc
  /** Field-schema metadata (title, status, author, date, custom fields). */
  metadata: Record<string, unknown>
  /** Git SHA the draft forked from (§2 base-SHA publish conflict guard). */
  baseSha: string | null
  /** Epoch ms. */
  createdAt: number
  updatedAt: number
}

/** Input to saveDraft (an upsert); timestamps are assigned by the adapter. */
export interface DraftInput extends EntryRef {
  content: TiptapDoc
  metadata: Record<string, unknown>
  baseSha?: string | null
}

/** A pessimistic edit lock on an entry (PRD §9). Policy (TTL) lives in core. */
export interface Lock extends EntryRef {
  lockedBy: string
  lockedAt: number
}

/** The database port. The DB is a derived index + live store, never the source
 *  of truth for published content (§2). This first slice covers drafts + locks. */
export interface DataPort {
  getDraft(ref: EntryRef): Promise<Draft | null>
  /** Upsert. Creates on first save (createdAt = updatedAt = now); on later saves
   *  updates content/metadata/baseSha and bumps updatedAt, leaving createdAt. */
  saveDraft(input: DraftInput): Promise<Draft>
  deleteDraft(ref: EntryRef): Promise<void>
  listDrafts(filter?: { collection?: string }): Promise<Draft[]>

  getLock(ref: EntryRef): Promise<Lock | null>
  /** Upsert the lock for an entry (storage only; acquire/TTL policy is core's). */
  putLock(lock: Lock): Promise<void>
  deleteLock(ref: EntryRef): Promise<void>

  /** Release adapter resources (close the DB handle). */
  close(): Promise<void>
}
```

`now`/timestamps: the **adapter** stamps `createdAt`/`updatedAt` from the system
clock for this slice (a thin storage concern). When core's lock/draft
orchestration arrives, time-sensitive *policy* will use an injected clock; the
adapter's storage stamping stays internal and is asserted via ordering, not exact
values, in the contract.

## Contract suite (`@setu/db-testing`)

`runDataPortContract(makeAdapter: () => Promise<DataPort> | DataPort): void`
registers a `describe('DataPort contract', …)` with Vitest. Each test gets a
fresh adapter via `makeAdapter` (a clean `:memory:` DB) in `beforeEach`, and
`close()`s in `afterEach`.

Assertions (the behavioral contract — adapter-agnostic):

**Drafts**
- `getDraft` returns `null` for an absent ref.
- `saveDraft` then `getDraft` returns an equal draft; `content` (nested Tiptap
  JSON), `metadata` (arbitrary JSON), and `baseSha` round-trip exactly.
- `baseSha` defaults to `null` when omitted from input.
- Upsert: a second `saveDraft` on the same ref updates `content`/`metadata` and
  yields `updatedAt >= ` the first, with `createdAt` unchanged. (Assert ordering
  / equality, not wall-clock values.)
- `deleteDraft` removes it (`getDraft` → `null`); deleting an absent ref is a
  no-op (does not throw).
- `listDrafts()` returns all saved drafts; `listDrafts({ collection })` returns
  only that collection's.
- **Ref isolation:** same `slug` under different `locale` (or `collection`) are
  distinct rows and don't overwrite each other.

**Locks**
- `getLock` returns `null` when none.
- `putLock` then `getLock` returns the lock (`lockedBy`, `lockedAt` exact).
- `putLock` again overwrites (last write wins).
- `deleteLock` removes it; deleting an absent lock is a no-op.

## `db-sqlite` adapter

**Schema (`schema.ts`, Drizzle `sqlite-core`):**
- `drafts`: columns `collection`, `locale`, `slug` (composite primary key),
  `content` (text, JSON), `metadata` (text, JSON), `base_sha` (text, nullable),
  `created_at` (integer, epoch ms), `updated_at` (integer, epoch ms).
- `locks`: columns `collection`, `locale`, `slug` (composite primary key),
  `locked_by` (text), `locked_at` (integer, epoch ms).

**Adapter (`adapter.ts`):** `createSqliteAdapter(file: string): DataPort`.
Opens a better-sqlite3 database at `file` (`':memory:'` in tests), applies
migrations (Drizzle `migrate`) to create tables, and implements `DataPort` by
mapping rows ↔ domain types (JSON-parsing `content`/`metadata`). `saveDraft`
upserts via `INSERT … ON CONFLICT(collection,locale,slug) DO UPDATE`, preserving
`created_at` and setting `updated_at = now`. `close()` closes the handle.

**Migrations:** a `drizzle.config.ts` + an initial generated migration committed
under `drizzle/`. The adapter runs migrations on construction so a fresh DB
(including `:memory:`) is ready. Per §2, these are derived/rebuildable tables.

## Error handling

- Reads of absent rows return `null` (drafts/locks), never throw.
- Deletes of absent rows are no-ops.
- JSON parse of stored `content`/`metadata` assumes adapter-written data is valid
  (the adapter is the only writer); a corrupt row surfaces as a thrown parse
  error rather than silent data loss — acceptable for a derived store.
- `saveDraft`/`putLock` upserts are idempotent on the composite key.

## Testing (TDD)

- **`@setu/db-testing`** is itself exercised by `db-sqlite` (no standalone tests;
  it's a harness). Type-only correctness via `tsc`.
- **`db-sqlite`**: `test/contract.test.ts` calls
  `runDataPortContract(() => createSqliteAdapter(':memory:'))`. Green = the
  adapter satisfies the entire port contract. (Adapter-specific tests — e.g.
  migrations create both tables — may be added but the contract is the core gate.)
- Root `pnpm test` runs all package suites; `pnpm typecheck` stays clean
  (including `@setu/core`'s edge-portability guard, which is unaffected — the
  DataPort interface is pure types and must remain Node-free; the better-sqlite3
  dependency lives only in `db-sqlite`).

## Definition of done

- `pnpm install` clean (better-sqlite3 builds via `onlyBuiltDependencies`).
- `pnpm typecheck` clean across all packages (core edge guard still green).
- `pnpm test` green: the `db-sqlite` contract suite passes the full DataPort
  contract; existing 37 `@setu/core` tests unaffected.
- `DataPort` + types exported from `@setu/core`; `runDataPortContract` exported
  from `@setu/db-testing`; `createSqliteAdapter` exported from `@setu/db-sqlite`.
- Committed via the subagent-driven flow.
