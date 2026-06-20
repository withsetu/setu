# Setu — Content Index & Query Foundation (Slice 1) — Design

> Status: approved for implementation · Date: 2026-06-19 · Branch: `feat/content-listing` (worktree)

## Overview

Replace the admin listing's "load every entry and merge in the browser" approach with a
**persisted, queryable index**. The listing screen today (`apps/admin/src/screens/ContentList.tsx`)
calls `git.readFile()` on *every committed file* on each load, then merges drafts + committed +
deploy state in memory. That is O(catalog) per screen visit — comfortable to ~500 entries in the
browser, unviable in an edge/API topology (~100 entries before round-trips dominate).

This foundation introduces a derived **index** of lightweight projection rows (refs + listing
fields, never bodies) and a **paginated query API** pushed down to the data layer, so listing
becomes one indexed query returning a page. It is **topology-agnostic** (IndexedDB cursor in the
browser, SQLite/API on the edge later) and **entity-agnostic** — the same `query` contract the
media library will reuse once it exists.

This is **Slice 1** of the foundation: the single-writer index that matches today's reality
(one user, browser, content edited only through the admin). External-change reconciliation and
the edge topology are explicitly **Slice 2** (see Out of Scope).

## Goals

- A persisted index of content projection rows, kept fresh as the admin makes changes.
- A `query({ collection, q?, status?, locale?, sort?, offset, limit }) → { rows, total }` contract.
- Migrate `ContentList` to consume the index (preserving current behaviour + basic pagination),
  proving the foundation end-to-end and removing the per-load full-Git read.
- An entity-agnostic seam that the media library can adopt later without redesign.

## Non-Goals (explicitly deferred)

- **External-change reconciliation (Slice 2):** detecting content changed *outside* the admin
  (another editor, push/pull, direct repo edit) requires a `GitPort.diff`/`changedPaths(fromSha,
  toSha)` capability that does not exist today (`GitPort` has only `headSha`/`list`/`readFile`/
  `commitFile`). Deferred until edge/multi-writer mode is turned on — the moment its complexity is
  justified.
- **The rich findability UI (separate spec, "Spec B"):** search box, status/locale filter
  controls, sortable column headers, per-row lock indicators, polished pagination. This spec
  ships only the *engine* + a minimal `ContentList` migration. The query contract already exposes
  `q`/`status`/`locale`/`sort`, so Spec B is pure UI wiring on top.
- **SQLite/API adapters:** Slice 1 ships `memory` + `idb` adapters (browser). The port is
  *defined* so `sqlite`/API implement it later with no UI change.
- **Media projection:** media reuses the `query` contract later; the shared kernel is extracted
  once two real consumers (content + media) prove the shape — not before.
- **Bulk actions** (delete/publish/unpublish multiple): a later content-listing UI concern.

## Architecture

A new port for the store, a core service for the derivation, and a thin migration of the consumer.

```
packages/core/src/index-port/
  index-port.ts        IndexPort interface (the seam) + EntryIndexRow, IndexQuery types
  index-service.ts     IndexService: cold build + incremental derivation (reuses listContentEntries)
packages/db-memory/    + in-memory IndexPort implementation
packages/db-idb/       + IndexedDB IndexPort implementation (new object store)
packages/db-testing/   + shared IndexPort contract test suite
apps/admin/src/
  data/store.tsx       wire IndexService into services; build/refresh on bootstrap
  screens/ContentList.tsx   consume index.query() (paginated) instead of load-all merge
```

### IndexPort (the topology-backed store seam)

```ts
export interface EntryIndexRow {
  key: string            // `${collection}\0${locale}\0${slug}` — collision-proof identity
  collection: string
  locale: string
  slug: string
  title: string
  titleLower: string     // precomputed for case-insensitive `q` matching
  status: LifecycleState // derived (draft | staged | live | unpublished)
  pending?: string       // lifecycle pending detail, when present
  updatedAt: number | null
  hasDraft: boolean
  author: string
}

export interface IndexQuery {
  collection: string
  q?: string                                   // substring match on title/slug
  status?: LifecycleState
  locale?: string
  sort?: { key: 'updatedAt' | 'title' | 'status'; dir: 'asc' | 'desc' }  // default updatedAt desc
  offset: number
  limit: number
}

export interface IndexMeta { indexedSha: string | null; version: number }

export interface IndexPort {
  query(q: IndexQuery): Promise<{ rows: EntryIndexRow[]; total: number }>
  upsert(row: EntryIndexRow): Promise<void>
  upsertMany(rows: EntryIndexRow[]): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  getMeta(): Promise<IndexMeta>
  setMeta(meta: IndexMeta): Promise<void>
}
```

The store performs filter/sort/paginate natively (IndexedDB cursor over an `updatedAt`/`title`
index; a simple array for `memory`). `total` is the count after filters (drives "x of N" and page
count). `EntryIndexRow` projects to the existing `ContentRow` shape for the UI, so consumers are
unchanged structurally.

### IndexService (core derivation logic)

Owns *how rows are derived*, reusing `listContentEntries` so the merge logic is not forked.

```ts
export interface IndexService {
  // Cold build: read all entries once, derive rows, replace the index, stamp indexedSha = HEAD.
  // Runs when getMeta() has null indexedSha or a stale `version`.
  rebuild(): Promise<void>
  // Ensure the index exists/current; rebuild only if needed. Called on bootstrap.
  ensureBuilt(): Promise<void>
  // Incremental: re-derive and upsert (or remove) the single affected entry's row.
  reindexEntry(ref: EntryRef): Promise<void>
  // Deploy flips staged↔live across the catalog: recompute affected rows.
  reindexAfterDeploy(): Promise<void>
  // Pass-through query.
  query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }>
}
```

Derivation per entry reuses the existing inputs: the entry's draft (`DataPort.getDraft`), its
committed content (`GitPort.readFile` of its content path), and the deploy snapshot
(`deployedAt`), fed through the same `listContentEntries`/`deriveLifecycle` path that produces
today's `ContentRow`, then projected to `EntryIndexRow`.

## The lifecycle/status crux (design decision)

`status` is a 3-source derivation (draft existence + committed file + deploy snapshot). **Decision:
store the *derived* `status` in the row** so status filtering/sorting is indexed and fast ("show
me all drafts" is a primary feature). The cost: **deploy is a bulk-invalidation trigger** — a
deploy flips many rows staged→live, so `reindexAfterDeploy()` recomputes the affected rows. This
is acceptable because deploy is infrequent and already iterates content. The rejected alternative
(store raw facts, compute status at read-time) keeps writes trivial but makes status filtering
un-indexable.

## Sync flow (Slice 1 — single writer)

The admin is the only writer, so the index never silently drifts:

- **Cold build** (`ensureBuilt` on bootstrap): if `getMeta().indexedSha` is null or `version` is
  stale → `rebuild()` (read all → derive → `upsertMany` → `setMeta({ indexedSha: HEAD, version })`).
  This is the one O(catalog) pass; everything after is incremental.
- **Incremental**, wired into the existing services:
  - `authoring.save` → `reindexEntry(ref)` (row now `hasDraft`, `updatedAt` bumped, status re-derived).
  - `publish.publish` / `unpublish` / `republish` → `reindexEntry(ref)` (committed changed).
  - draft delete → `reindexEntry(ref)` (row removed if draft-only and no commit, else re-derived).
  - `deploy` → `reindexAfterDeploy()`.

No `GitPort.diff` is needed in Slice 1 — external changes are out of scope (Slice 2).

## Consumer migration (`ContentList`)

Replace the load-all-and-merge effect with `index.query({ collection, offset, limit, sort: {
key: 'updatedAt', dir: 'desc' } })`. Render the returned page; add basic **prev/next pagination**
driving `offset`. Behaviour is preserved (a collection's entries, newest first) but backed by the
index — no per-load full-Git read. The search/filter/sort *controls* are Spec B; this migration
only switches the data source and adds paging so the foundation is exercised end-to-end.

## Topology notes

- **Browser/local (Slice 1):** `idb` implements `IndexPort` over a new IndexedDB object store with
  indexes on `updatedAt` and `title`; `memory` over an array. `ContentList` calls the service.
- **Edge (later):** an API-backed `IndexPort` hits a server index (e.g. D1/SQLite); the admin UI
  is identical — only the adapter differs. Slice 1 does not build this but must not preclude it
  (hence the port-level seam and `offset/limit/total` contract).

## Error handling

- `query` rejecting surfaces as the consumer's existing inline empty/error state (the
  `ContentList` migration keeps a single error line rather than throwing).
- `ensureBuilt`/`rebuild` failures are logged and leave the prior index intact; the screen falls
  back to an empty/error state rather than a broken merge. A failed `reindexEntry` after a
  successful save does not fail the save — it logs and the next `ensureBuilt`/`rebuild` heals it.

## Testing

- **`IndexService` unit tests** (memory-backed): cold build produces correct rows; `reindexEntry`
  updates/removes the right row on save/publish/delete; `reindexAfterDeploy` flips staged→live;
  `query` honours `q`/`status`/`locale`/`sort`/`offset`/`limit` and returns correct `total`.
- **`IndexPort` contract test** in `db-testing`: one suite run against `memory` + `idb` (mirrors
  the existing `storage-testing`/`db-testing` contract pattern), covering upsert/remove/clear,
  query filtering/sorting/paging, and meta round-trip.
- **Wiring tests** (admin): a `save`/`publish`/`delete`/`deploy` through the services leaves the
  index reflecting the change; `ContentList` renders a queried page and paginates.
- Baseline before work: 213 admin tests passing.

## Open considerations / risks

- **Cold-build cost on large existing catalogs** is the one remaining O(catalog) moment; it runs
  once per `version` bump. Acceptable for Slice 1's single-writer browser scale; the edge slice
  moves first-build server-side.
- **`version` bumps force a full rebuild** — used deliberately when the projection schema changes.
- **`idb` query indexes** must cover the default sort (`updatedAt`) and `title`; `status`/`locale`
  filters may scan within a collection partition — fine at Slice 1 scale, revisited if needed.
