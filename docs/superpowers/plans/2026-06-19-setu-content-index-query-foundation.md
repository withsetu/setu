# Content Index & Query Foundation (Slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persisted, queryable content index + paginated `query()` API that replaces the admin listing's load-every-Git-file approach, kept fresh as the (single) admin user makes changes.

**Architecture:** A new entity-agnostic `IndexPort` (topology-backed store) holds lightweight projection rows; a pure `runQuery` does filter/sort/paginate (shared by all adapters, since rows are tiny); a core `IndexService` derives rows by reusing `listContentEntries` (cold build + per-entry incremental); the admin wires it via an `IndexProvider` and `ContentList` queries it.

**Tech Stack:** TypeScript, `@setu/core`, `idb` (IndexedDB wrapper, already a dep), Vitest, React 18.

## Global Constraints

- **No new network calls; Cloudflare-Pages-compatible pure client code.**
- **Single-writer scope:** the admin is the only writer; no external-change reconciliation, no `GitPort.diff`. (Slice 2.)
- **Reuse `listContentEntries` for derivation** — do not fork the merge/lifecycle logic.
- **`runQuery` is the only filter/sort/paginate implementation** — both adapters delegate to it.
- **Entity-agnostic contract:** `query({ collection, q?, status?, locale?, sort?, offset, limit }) → { rows, total }`. Media reuses it later.
- **TDD throughout.** Baseline before work: **213 admin tests passing** (`cd apps/admin && pnpm test`); core/package tests via `pnpm -w test` or per-package `pnpm test`.
- **Verified types (use verbatim):**
  - `EntryRef = { collection: string; locale: string; slug: string }`.
  - `LifecycleState = 'draft' | 'staged' | 'live' | 'unpublished'`; `LifecyclePending = 'edited' | 'staged' | 'unpublishing'`; `Lifecycle = { state: LifecycleState; pending?: LifecyclePending }`.
  - `ContentRow = { ref: EntryRef; title: string; locale: string; lifecycle: Lifecycle; updatedAt: number | null; hasDraft: boolean }` (from `@setu/core`).
  - `listContentEntries({ drafts: Draft[]; committed: { ref: EntryRef; content: string }[]; deployedAt: (path: string) => string | null }): ContentRow[]` (from `@setu/core`).
  - `parseContentPath(path): EntryRef | null`, `contentPath(ref): string` (from `@setu/core`).
  - `DataPort.listDrafts(filter?) / getDraft(ref) / deleteDraft(ref)`; `GitPort.list(prefix?) / readFile(path) / headSha()`.
  - The composite key is NUL-joined: `` `${collection}\0${locale}\0${slug}` `` (matches db-memory/db-idb).
- **Author field is deferred to the listing-UI spec (Spec B)** — `EntryIndexRow` omits `author` in Slice 1 (one-line deviation from the design's row sketch, to avoid unused derivation).

---

### Task 1: Core index-port types + projection helpers

**Files:**
- Create: `packages/core/src/index-port/types.ts`
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/test/index-port/types.test.ts`

**Interfaces:**
- Produces:
  - Types `EntryIndexRow`, `SortKey`, `IndexQuery`, `IndexMeta`, `IndexPort` (see code).
  - `indexKey(ref: EntryRef): string`.
  - `projectRow(row: ContentRow): EntryIndexRow`.
  - `rowToContentRow(r: EntryIndexRow): ContentRow`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/index-port/types.test.ts
import { describe, it, expect } from 'vitest'
import type { ContentRow } from '../../src/index'
import { projectRow, rowToContentRow, indexKey } from '../../src/index'

const cr: ContentRow = {
  ref: { collection: 'post', locale: 'en', slug: 'hello' },
  title: 'Hello',
  locale: 'en',
  lifecycle: { state: 'staged', pending: 'edited' },
  updatedAt: 5,
  hasDraft: true,
}

describe('index-port projection', () => {
  it('indexKey is NUL-joined', () => {
    expect(indexKey(cr.ref)).toBe('post\0en\0hello')
  })

  it('projectRow flattens a ContentRow into an index row', () => {
    expect(projectRow(cr)).toEqual({
      key: 'post\0en\0hello',
      collection: 'post', locale: 'en', slug: 'hello',
      title: 'Hello', titleLower: 'hello',
      status: 'staged', pending: 'edited',
      updatedAt: 5, hasDraft: true,
    })
  })

  it('rowToContentRow is the inverse projection', () => {
    expect(rowToContentRow(projectRow(cr))).toEqual(cr)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test index-port/types`
Expected: FAIL — cannot resolve `projectRow` from `../../src/index`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/index-port/types.ts
import type { EntryRef } from '../data/types'
import type { LifecycleState, LifecyclePending } from '../lifecycle/derive'
import type { ContentRow } from '../content-index/list-entries'

export interface EntryIndexRow {
  key: string
  collection: string
  locale: string
  slug: string
  title: string
  titleLower: string
  status: LifecycleState
  pending?: LifecyclePending
  updatedAt: number | null
  hasDraft: boolean
}

export type SortKey = 'updatedAt' | 'title' | 'status'

export interface IndexQuery {
  collection: string
  q?: string
  status?: LifecycleState
  locale?: string
  sort?: { key: SortKey; dir: 'asc' | 'desc' }
  offset: number
  limit: number
}

export interface IndexMeta {
  indexedSha: string | null
  version: number
}

export interface IndexPort {
  query(q: IndexQuery): Promise<{ rows: EntryIndexRow[]; total: number }>
  upsert(row: EntryIndexRow): Promise<void>
  upsertMany(rows: EntryIndexRow[]): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  getMeta(): Promise<IndexMeta>
  setMeta(meta: IndexMeta): Promise<void>
}

export const indexKey = (ref: EntryRef): string => `${ref.collection}\0${ref.locale}\0${ref.slug}`

export function projectRow(row: ContentRow): EntryIndexRow {
  const out: EntryIndexRow = {
    key: indexKey(row.ref),
    collection: row.ref.collection,
    locale: row.ref.locale,
    slug: row.ref.slug,
    title: row.title,
    titleLower: row.title.toLowerCase(),
    status: row.lifecycle.state,
    updatedAt: row.updatedAt,
    hasDraft: row.hasDraft,
  }
  if (row.lifecycle.pending !== undefined) out.pending = row.lifecycle.pending
  return out
}

export function rowToContentRow(r: EntryIndexRow): ContentRow {
  const lifecycle = r.pending !== undefined ? { state: r.status, pending: r.pending } : { state: r.status }
  return {
    ref: { collection: r.collection, locale: r.locale, slug: r.slug },
    title: r.title,
    locale: r.locale,
    lifecycle,
    updatedAt: r.updatedAt,
    hasDraft: r.hasDraft,
  }
}
```

Add to `packages/core/src/index.ts` (next to the existing `content-index` exports):

```ts
export type { EntryIndexRow, SortKey, IndexQuery, IndexMeta, IndexPort } from './index-port/types'
export { indexKey, projectRow, rowToContentRow } from './index-port/types'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm test index-port/types`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index-port/types.ts packages/core/src/index.ts packages/core/test/index-port/types.test.ts
git commit -m "feat(core): index-port types + projection helpers"
```

---

### Task 2: Pure `runQuery` (filter/sort/paginate)

**Files:**
- Create: `packages/core/src/index-port/run-query.ts`
- Modify: `packages/core/src/index.ts` (export `runQuery`)
- Test: `packages/core/test/index-port/run-query.test.ts`

**Interfaces:**
- Consumes: `EntryIndexRow`, `IndexQuery` (Task 1).
- Produces: `runQuery(rows: EntryIndexRow[], q: IndexQuery): { rows: EntryIndexRow[]; total: number }` — filters by `collection` (required), then `locale`/`status`/`q` (title or slug substring, case-insensitive); sorts (default `updatedAt desc`, nulls last); returns the `offset..offset+limit` page and the post-filter `total`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/index-port/run-query.test.ts
import { describe, it, expect } from 'vitest'
import type { EntryIndexRow } from '../../src/index'
import { runQuery } from '../../src/index'

const row = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`, collection: 'post', locale: 'en', slug: 'x',
  title: 'X', titleLower: 'x', status: 'draft', updatedAt: 0, hasDraft: true, ...over,
})

const rows: EntryIndexRow[] = [
  row({ slug: 'a', title: 'Alpha', titleLower: 'alpha', updatedAt: 3, status: 'live' }),
  row({ slug: 'b', title: 'Bravo', titleLower: 'bravo', updatedAt: 1, status: 'draft' }),
  row({ slug: 'c', title: 'Charlie', titleLower: 'charlie', updatedAt: null, status: 'draft' }),
  { ...row({ slug: 'd', title: 'Delta', titleLower: 'delta' }), collection: 'page' },
]

describe('runQuery', () => {
  it('filters to the collection and sorts by updatedAt desc with nulls last', () => {
    const r = runQuery(rows, { collection: 'post', offset: 0, limit: 10 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.slug)).toEqual(['a', 'b', 'c'])
  })

  it('filters by status', () => {
    const r = runQuery(rows, { collection: 'post', status: 'draft', offset: 0, limit: 10 })
    expect(r.rows.map((x) => x.slug)).toEqual(['b', 'c'])
  })

  it('searches title and slug case-insensitively', () => {
    expect(runQuery(rows, { collection: 'post', q: 'ALP', offset: 0, limit: 10 }).rows.map((x) => x.slug)).toEqual(['a'])
    expect(runQuery(rows, { collection: 'post', q: 'b', offset: 0, limit: 10 }).rows.map((x) => x.slug).sort()).toEqual(['b'])
  })

  it('sorts by title asc and paginates with a stable total', () => {
    const r = runQuery(rows, { collection: 'post', sort: { key: 'title', dir: 'asc' }, offset: 1, limit: 1 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.slug)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test index-port/run-query`
Expected: FAIL — cannot resolve `runQuery`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/index-port/run-query.ts
import type { EntryIndexRow, IndexQuery, SortKey } from './types'

function compare(a: EntryIndexRow, b: EntryIndexRow, key: SortKey): number {
  if (key === 'title') return a.titleLower.localeCompare(b.titleLower)
  if (key === 'status') return a.status.localeCompare(b.status)
  // updatedAt: nulls last regardless of direction is applied by caller; here null → -Infinity
  const av = a.updatedAt ?? -Infinity
  const bv = b.updatedAt ?? -Infinity
  return av - bv
}

export function runQuery(
  rows: EntryIndexRow[],
  q: IndexQuery,
): { rows: EntryIndexRow[]; total: number } {
  let xs = rows.filter((r) => r.collection === q.collection)
  if (q.locale) xs = xs.filter((r) => r.locale === q.locale)
  if (q.status) xs = xs.filter((r) => r.status === q.status)
  if (q.q && q.q.length > 0) {
    const needle = q.q.toLowerCase()
    xs = xs.filter((r) => r.titleLower.includes(needle) || r.slug.toLowerCase().includes(needle))
  }
  const sort = q.sort ?? { key: 'updatedAt' as SortKey, dir: 'desc' as const }
  const sorted = [...xs].sort((a, b) => {
    const c = compare(a, b, sort.key)
    return sort.dir === 'asc' ? c : -c
  })
  const total = sorted.length
  return { rows: sorted.slice(q.offset, q.offset + q.limit), total }
}
```

Add to `packages/core/src/index.ts`:

```ts
export { runQuery } from './index-port/run-query'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm test index-port/run-query`
Expected: PASS (4 tests). Note: `updatedAt desc` with null → `-Infinity` then negated puts nulls last, matching the first test's `['a','b','c']`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index-port/run-query.ts packages/core/src/index.ts packages/core/test/index-port/run-query.test.ts
git commit -m "feat(core): pure runQuery for the content index"
```

---

### Task 3: `IndexPort` contract test suite

**Files:**
- Modify: `packages/db-testing/src/index.ts` (add `runIndexPortContract`)
- Test: (the suite itself is consumed by Tasks 4 & 5)

**Interfaces:**
- Consumes: `IndexPort`, `EntryIndexRow` (Task 1).
- Produces: `runIndexPortContract(makeAdapter: () => Promise<IndexPort> | IndexPort): void` — a `describe` block asserting upsert/upsertMany/remove/clear, `query` filtering/sorting/paging/total, and meta round-trip.

- [ ] **Step 1: Add the contract suite (no separate test run yet — it executes via Tasks 4/5)**

```ts
// append to packages/db-testing/src/index.ts
import type { IndexPort, EntryIndexRow } from '@setu/core'

const irow = (over: Partial<EntryIndexRow>): EntryIndexRow => ({
  key: `post\0en\0${over.slug ?? 'x'}`, collection: 'post', locale: 'en', slug: over.slug ?? 'x',
  title: over.title ?? 'X', titleLower: (over.title ?? 'X').toLowerCase(),
  status: over.status ?? 'draft', updatedAt: over.updatedAt ?? 0, hasDraft: true, ...over,
})

export function runIndexPortContract(makeAdapter: () => Promise<IndexPort> | IndexPort): void {
  describe('IndexPort contract', () => {
    let ix: IndexPort
    beforeEach(async () => {
      ix = await makeAdapter()
    })

    it('upserts and queries back a row', async () => {
      await ix.upsert(irow({ slug: 'a', title: 'Alpha' }))
      const r = await ix.query({ collection: 'post', offset: 0, limit: 10 })
      expect(r.total).toBe(1)
      expect(r.rows[0]!.slug).toBe('a')
    })

    it('upsertMany, filters by status, paginates with total', async () => {
      await ix.upsertMany([
        irow({ slug: 'a', status: 'live', updatedAt: 3 }),
        irow({ slug: 'b', status: 'draft', updatedAt: 2 }),
        irow({ slug: 'c', status: 'draft', updatedAt: 1 }),
      ])
      const drafts = await ix.query({ collection: 'post', status: 'draft', offset: 0, limit: 1 })
      expect(drafts.total).toBe(2)
      expect(drafts.rows).toHaveLength(1)
      expect(drafts.rows[0]!.slug).toBe('b') // updatedAt desc
    })

    it('remove and clear', async () => {
      await ix.upsertMany([irow({ slug: 'a' }), irow({ slug: 'b' })])
      await ix.remove('post\0en\0a')
      expect((await ix.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(1)
      await ix.clear()
      expect((await ix.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(0)
    })

    it('meta round-trips and defaults to null/0', async () => {
      expect(await ix.getMeta()).toEqual({ indexedSha: null, version: 0 })
      await ix.setMeta({ indexedSha: 'abc', version: 2 })
      expect(await ix.getMeta()).toEqual({ indexedSha: 'abc', version: 2 })
    })
  })
}
```

- [ ] **Step 2: Build-check the package**

Run: `cd packages/db-testing && pnpm typecheck` (or `pnpm -w typecheck`)
Expected: no type errors (the suite references only exported `@setu/core` types).

- [ ] **Step 3: Commit**

```bash
git add packages/db-testing/src/index.ts
git commit -m "test(db-testing): IndexPort contract suite"
```

---

### Task 4: `db-memory` IndexPort adapter

**Files:**
- Create: `packages/db-memory/src/index-port.ts`
- Modify: `packages/db-memory/src/index.ts` (export `createMemoryIndexPort`)
- Test: `packages/db-memory/test/index-contract.test.ts`

**Interfaces:**
- Consumes: `IndexPort`, `runQuery` (Tasks 1–2); `runIndexPortContract` (Task 3).
- Produces: `createMemoryIndexPort(): IndexPort`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db-memory/test/index-contract.test.ts
import { runIndexPortContract } from '@setu/db-testing'
import { createMemoryIndexPort } from '../src/index'

runIndexPortContract(() => createMemoryIndexPort())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db-memory && pnpm test index-contract`
Expected: FAIL — `createMemoryIndexPort` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/db-memory/src/index-port.ts
import type { EntryIndexRow, IndexMeta, IndexPort, IndexQuery } from '@setu/core'
import { runQuery } from '@setu/core'

/** In-memory IndexPort (Map-backed). Value semantics via structuredClone. */
export function createMemoryIndexPort(): IndexPort {
  const rows = new Map<string, EntryIndexRow>()
  let meta: IndexMeta = { indexedSha: null, version: 0 }
  return {
    async query(q: IndexQuery) {
      return runQuery([...rows.values()], q)
    },
    async upsert(row) {
      rows.set(row.key, structuredClone(row))
    },
    async upsertMany(rs) {
      for (const r of rs) rows.set(r.key, structuredClone(r))
    },
    async remove(key) {
      rows.delete(key)
    },
    async clear() {
      rows.clear()
    },
    async getMeta() {
      return { ...meta }
    },
    async setMeta(m) {
      meta = { ...m }
    },
  }
}
```

Add to `packages/db-memory/src/index.ts`:

```ts
export { createMemoryIndexPort } from './index-port'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db-memory && pnpm test`
Expected: PASS — the existing DataPort contract + the new IndexPort contract (4 tests) all green.

- [ ] **Step 5: Commit**

```bash
git add packages/db-memory/src/index-port.ts packages/db-memory/src/index.ts packages/db-memory/test/index-contract.test.ts
git commit -m "feat(db-memory): in-memory IndexPort adapter"
```

---

### Task 5: `db-idb` IndexPort adapter

**Files:**
- Create: `packages/db-idb/src/index-port.ts`
- Modify: `packages/db-idb/src/index.ts` (export `createIdbIndexPort`)
- Test: `packages/db-idb/test/index-contract.test.ts`

**Interfaces:**
- Consumes: `IndexPort`, `runQuery` (Tasks 1–2); `runIndexPortContract` (Task 3); the `idb` library (`openDB`).
- Produces: `createIdbIndexPort(dbName?: string): Promise<IndexPort>`.

**Note:** mirror the existing `packages/db-idb/test/contract.test.ts` setup exactly — it already runs IndexedDB in Node (fake-indexeddb / configured environment). Pass a unique `dbName` per test invocation as that file does, so each run starts fresh.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db-idb/test/index-contract.test.ts
// Mirror the env/import setup of ./contract.test.ts (same fake-indexeddb wiring).
import { runIndexPortContract } from '@setu/db-testing'
import { createIdbIndexPort } from '../src/index'

let n = 0
runIndexPortContract(() => createIdbIndexPort(`setu-index-test-${n++}`))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db-idb && pnpm test index-contract`
Expected: FAIL — `createIdbIndexPort` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/db-idb/src/index-port.ts
import { openDB } from 'idb'
import type { EntryIndexRow, IndexMeta, IndexPort } from '@setu/core'
import { runQuery } from '@setu/core'

/** IndexedDB-backed IndexPort. Rows are tiny (no bodies), so `query` loads the
 *  store and delegates to the shared pure `runQuery` — fast at Slice 1 scale and
 *  identical semantics to db-memory (proven by runIndexPortContract). */
export async function createIdbIndexPort(dbName = 'setu-index'): Promise<IndexPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('entries')
      d.createObjectStore('meta')
    },
  })
  return {
    async query(q) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return runQuery(all, q)
    },
    async upsert(row) {
      await db.put('entries', row, row.key)
    },
    async upsertMany(rows) {
      const tx = db.transaction('entries', 'readwrite')
      await Promise.all([...rows.map((r) => tx.store.put(r, r.key)), tx.done])
    },
    async remove(key) {
      await db.delete('entries', key)
    },
    async clear() {
      await db.clear('entries')
    },
    async getMeta() {
      return ((await db.get('meta', 'meta')) as IndexMeta | undefined) ?? { indexedSha: null, version: 0 }
    },
    async setMeta(m) {
      await db.put('meta', m, 'meta')
    },
  }
}
```

Add to `packages/db-idb/src/index.ts`:

```ts
export { createIdbIndexPort } from './index-port'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db-idb && pnpm test`
Expected: PASS — existing DataPort contract + new IndexPort contract green.

- [ ] **Step 5: Commit**

```bash
git add packages/db-idb/src/index-port.ts packages/db-idb/src/index.ts packages/db-idb/test/index-contract.test.ts
git commit -m "feat(db-idb): IndexedDB IndexPort adapter"
```

---

### Task 6: `IndexService` — rebuild / ensureBuilt / query

**Files:**
- Create: `packages/core/src/index-port/index-service.ts`
- Modify: `packages/core/src/index.ts` (export `createIndexService`, `IndexService`, `IndexServiceDeps`, `INDEX_VERSION`)
- Test: `packages/core/test/index-port/index-service.test.ts`

**Interfaces:**
- Consumes: `IndexPort`, `projectRow`, `rowToContentRow`, `listContentEntries`, `parseContentPath`, `DataPort`, `GitPort`, `ContentRow`, `IndexQuery` (Task 1 + core).
- Produces:
  - `INDEX_VERSION = 1` (bump to force a rebuild on schema change).
  - `IndexServiceDeps = { data: DataPort; git: GitPort; index: IndexPort; deployedAt: (path: string) => string | null }`.
  - `IndexService = { rebuild(): Promise<void>; ensureBuilt(): Promise<void>; reindexEntry(ref): Promise<void>; reindexAfterDeploy(): Promise<void>; query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }> }`.
  - `createIndexService(deps: IndexServiceDeps): IndexService`.
- This task implements `rebuild`, `ensureBuilt`, `query`; Task 7 adds `reindexEntry`, `reindexAfterDeploy` to the same file.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/index-port/index-service.test.ts
import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryIndexPort } from '@setu/db-memory'
import type { DraftInput, TiptapDoc } from '../../src/index'
import { createIndexService, INDEX_VERSION } from '../../src/index'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'Alpha' } },
  { collection: 'post', locale: 'en', slug: 'b', content: doc('b'), metadata: { title: 'Bravo' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('c'), metadata: { title: 'About' } },
]
const noDeploy = () => null

function svc() {
  const data = createMemoryDataPort(seed)
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  return { data, git, index, service: createIndexService({ data, git, index, deployedAt: noDeploy }) }
}

describe('IndexService rebuild/ensureBuilt/query', () => {
  it('rebuild populates the index from drafts + git and stamps meta', async () => {
    const { index, service } = svc()
    await service.rebuild()
    const r = await service.query({ collection: 'post', offset: 0, limit: 10 })
    expect(r.total).toBe(2)
    expect(r.rows.map((x) => x.title).sort()).toEqual(['Alpha', 'Bravo'])
    expect((await index.getMeta()).version).toBe(INDEX_VERSION)
  })

  it('ensureBuilt builds when empty and is a no-op when already current', async () => {
    const { index, service } = svc()
    await service.ensureBuilt()
    expect((await index.getMeta()).indexedSha).not.toBeUndefined()
    await index.clear() // simulate: rows gone but meta still current
    await service.ensureBuilt() // version matches → no rebuild
    expect((await service.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(0)
  })

  it('query maps index rows back to ContentRow shape', async () => {
    const { service } = svc()
    await service.rebuild()
    const r = await service.query({ collection: 'page', offset: 0, limit: 10 })
    expect(r.rows[0]).toMatchObject({ ref: { collection: 'page', locale: 'en', slug: 'about' }, title: 'About' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test index-port/index-service`
Expected: FAIL — cannot resolve `createIndexService`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/index-port/index-service.ts
import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { EntryRef } from '../data/types'
import type { ContentRow } from '../content-index/list-entries'
import { listContentEntries } from '../content-index/list-entries'
import { parseContentPath, contentPath } from '../publish/content-path'
import type { IndexPort, IndexQuery } from './types'
import { projectRow, rowToContentRow, indexKey } from './types'

export const INDEX_VERSION = 1

export interface IndexServiceDeps {
  data: DataPort
  git: GitPort
  index: IndexPort
  deployedAt: (path: string) => string | null
}

export interface IndexService {
  rebuild(): Promise<void>
  ensureBuilt(): Promise<void>
  reindexEntry(ref: EntryRef): Promise<void>
  reindexAfterDeploy(): Promise<void>
  query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }>
}

export function createIndexService(deps: IndexServiceDeps): IndexService {
  const { data, git, index, deployedAt } = deps

  async function rebuild(): Promise<void> {
    const drafts = await data.listDrafts()
    const committed: { ref: EntryRef; content: string }[] = []
    for (const p of await git.list('content/')) {
      const ref = parseContentPath(p)
      if (ref === null) continue
      const content = await git.readFile(p)
      if (content !== null) committed.push({ ref, content })
    }
    const rows = listContentEntries({ drafts, committed, deployedAt }).map(projectRow)
    await index.clear()
    await index.upsertMany(rows)
    await index.setMeta({ indexedSha: await git.headSha(), version: INDEX_VERSION })
  }

  async function ensureBuilt(): Promise<void> {
    const meta = await index.getMeta()
    if (meta.indexedSha === null || meta.version !== INDEX_VERSION) await rebuild()
  }

  // reindexEntry + reindexAfterDeploy are added in Task 7.
  async function reindexEntry(_ref: EntryRef): Promise<void> {
    throw new Error('not implemented')
  }
  async function reindexAfterDeploy(): Promise<void> {
    throw new Error('not implemented')
  }

  async function query(q: IndexQuery): Promise<{ rows: ContentRow[]; total: number }> {
    const { rows, total } = await index.query(q)
    return { rows: rows.map(rowToContentRow), total }
  }

  return { rebuild, ensureBuilt, reindexEntry, reindexAfterDeploy, query }
}
```

Add to `packages/core/src/index.ts`:

```ts
export type { IndexService, IndexServiceDeps } from './index-port/index-service'
export { createIndexService, INDEX_VERSION } from './index-port/index-service'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm test index-port/index-service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index-port/index-service.ts packages/core/src/index.ts packages/core/test/index-port/index-service.test.ts
git commit -m "feat(core): IndexService rebuild/ensureBuilt/query"
```

---

### Task 7: `IndexService` — reindexEntry / reindexAfterDeploy

**Files:**
- Modify: `packages/core/src/index-port/index-service.ts` (replace the two stubs)
- Test: `packages/core/test/index-port/index-service-reindex.test.ts`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: working `reindexEntry(ref)` (re-derive one entry → upsert, or remove when it has neither draft nor commit) and `reindexAfterDeploy()` (rebuild — Slice 1 simplification; deploy is infrequent and already iterates content).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/index-port/index-service-reindex.test.ts
import { describe, it, expect } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '../../src/index'
import { createIndexService } from '../../src/index'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'Alpha' } },
]

function svc() {
  const data = createMemoryDataPort(seed)
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  return { data, index, service: createIndexService({ data, git, index, deployedAt: () => null }) }
}

describe('IndexService reindexEntry', () => {
  it('upserts a row for a newly saved draft', async () => {
    const { data, service } = svc()
    await service.rebuild()
    await data.saveDraft({ collection: 'post', locale: 'en', slug: 'b', content: doc('b'), metadata: { title: 'Bravo' } })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    const r = await service.query({ collection: 'post', offset: 0, limit: 10 })
    expect(r.rows.map((x) => x.title).sort()).toEqual(['Alpha', 'Bravo'])
  })

  it('removes the row when the entry has neither draft nor commit', async () => {
    const { data, service } = svc()
    await service.rebuild()
    await data.deleteDraft({ collection: 'post', locale: 'en', slug: 'a' })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    expect((await service.query({ collection: 'post', offset: 0, limit: 10 })).total).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test index-port/index-service-reindex`
Expected: FAIL — `reindexEntry` throws `not implemented`.

- [ ] **Step 3: Replace the two stub functions with:**

```ts
  async function reindexEntry(ref: EntryRef): Promise<void> {
    const draft = await data.getDraft(ref)
    const committedStr = await git.readFile(contentPath(ref))
    const drafts = draft ? [draft] : []
    const committed = committedStr !== null ? [{ ref, content: committedStr }] : []
    const rows = listContentEntries({ drafts, committed, deployedAt })
    if (rows.length === 0) await index.remove(indexKey(ref))
    else await index.upsert(projectRow(rows[0]!))
  }

  async function reindexAfterDeploy(): Promise<void> {
    await rebuild()
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm test index-port/index-service`
Expected: PASS — both index-service test files green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index-port/index-service.ts packages/core/test/index-port/index-service-reindex.test.ts
git commit -m "feat(core): IndexService reindexEntry + reindexAfterDeploy"
```

---

### Task 8: Admin wiring — `IndexProvider` + reindex on save/publish

**Files:**
- Create: `apps/admin/src/data/index-store.tsx` (`IndexProvider`, `useIndex`)
- Modify: the app provider tree where `ServicesProvider` + `DeployProvider` are mounted (find via `grep -rn "DeployProvider" apps/admin/src/main.tsx apps/admin/src/*.tsx`) — wrap children in `<IndexProvider>` *inside* `DeployProvider` (it needs `useDeploy`).
- Modify: `apps/admin/src/editor/EditorScreen.tsx` — after `authoring.save(...)` and after `publish.publish(...)`, call `index.reindexEntry(ref)` (the save/publish call sites are around EditorScreen.tsx:127/134/155-156).
- Test: `apps/admin/test/index-provider.test.tsx`

**Interfaces:**
- Consumes: `createIndexService` (core), `createMemoryIndexPort` (db-memory), `useServices` + `useDeploy` (admin).
- Produces: `IndexProvider` (builds the service from current services + deploy snapshot, runs `ensureBuilt` on mount, runs `reindexAfterDeploy` when `deploy.sha` changes) and `useIndex(): IndexService`.

**Design notes for the implementer:**
- `IndexProvider` must sit *under* `DeployProvider` and `ServicesProvider` so it can call `useServices()` and `useDeploy()`.
- Create the IndexPort with `createMemoryIndexPort()` (the app currently runs on in-memory adapters per `store.tsx`; the idb index swaps in when idb persistence is wired — out of scope here).
- Build the service once (`useMemo` over `data`/`git`): `createIndexService({ data, git, index, deployedAt: deploy.deployedAt })`. `deploy.deployedAt` is a stable `useCallback` that reads current deploy state, so the service always sees live deploy status.
- `useEffect(() => { void service.ensureBuilt() }, [service])` for the cold build.
- `useEffect(() => { void service.reindexAfterDeploy() }, [deploy.sha])` — but guard the first run (skip when it would duplicate `ensureBuilt`); simplest: only call when `deploy.sha !== null`.
- `reindexEntry` failures must NOT break editing — wrap call sites in `void index.reindexEntry(ref).catch(() => {})`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/index-provider.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider, useIndex } from '../src/data/index-store'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const seed: DraftInput[] = [{ collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: { title: 'Alpha' } }]

function Probe() {
  const index = useIndex()
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    void (async () => {
      await index.ensureBuilt()
      setN((await index.query({ collection: 'post', offset: 0, limit: 10 })).total)
    })()
  }, [index])
  return <div>total:{n ?? '…'}</div>
}

describe('IndexProvider', () => {
  it('provides a built index service', async () => {
    render(
      <ServicesProvider services={servicesFor(createMemoryDataPort(seed), createMemoryGitPort())}>
        <DeployProvider>
          <IndexProvider>
            <Probe />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>,
    )
    await waitFor(() => expect(screen.getByText(/total:1/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test index-provider`
Expected: FAIL — cannot resolve `../src/data/index-store`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/admin/src/data/index-store.tsx
import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { IndexService } from '@setu/core'
import { createIndexService } from '@setu/core'
import { createMemoryIndexPort } from '@setu/db-memory'
import { useServices } from './store'
import { useDeploy } from '../deploy/deploy'

const IndexContext = createContext<IndexService | null>(null)

export function IndexProvider({ children }: { children: ReactNode }) {
  const { data, git } = useServices()
  const deploy = useDeploy()
  const service = useMemo(
    () => createIndexService({ data, git, index: createMemoryIndexPort(), deployedAt: deploy.deployedAt }),
    [data, git, deploy.deployedAt],
  )
  useEffect(() => {
    void service.ensureBuilt()
  }, [service])
  useEffect(() => {
    if (deploy.sha !== null) void service.reindexAfterDeploy()
  }, [deploy.sha, service])
  return <IndexContext.Provider value={service}>{children}</IndexContext.Provider>
}

export function useIndex(): IndexService {
  const ctx = useContext(IndexContext)
  if (ctx === null) throw new Error('useIndex must be used within an IndexProvider')
  return ctx
}
```

Then: (a) mount `<IndexProvider>` inside `DeployProvider` in the app provider tree; (b) in `EditorScreen.tsx`, import `useIndex`, and after the existing `authoring.save(...)` and `publish.publish(...)` calls add `void index.reindexEntry(ref).catch(() => {})` (where `ref` is the screen's current entry ref and `index = useIndex()`).

- [ ] **Step 4: Run tests**

Run: `cd apps/admin && pnpm test index-provider`
Expected: PASS.
Run: `cd apps/admin && pnpm test` and `pnpm typecheck`
Expected: full suite green (213 prior + new), 0 type errors. If mounting `IndexProvider` broke a test that renders the app tree, add the provider there too.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/data/index-store.tsx apps/admin/src/editor/EditorScreen.tsx apps/admin/src/main.tsx apps/admin/test/index-provider.test.tsx
git commit -m "feat(admin): IndexProvider + reindex on save/publish/deploy"
```

---

### Task 9: Migrate `ContentList` to `index.query` + pagination

**Files:**
- Modify: `apps/admin/src/screens/ContentList.tsx`
- Test: `apps/admin/test/content-list.test.tsx` (extend; keep existing assertions working)

**Interfaces:**
- Consumes: `useIndex` (Task 8) → `index.query({ collection, offset, limit, sort })`.
- Produces: a paginated `ContentList` (newest-first) backed by the index instead of the load-all merge. Page size constant `PAGE_SIZE = 25`. Prev/Next controls drive `offset`; show "x–y of N".

**Design notes:**
- Replace the `useEffect` that called `data.listDrafts` + `git.list`/`git.readFile` with one that calls `index.query`. Keep the `ContentRow[]` shape the table already renders — `index.query` returns `{ rows: ContentRow[], total }`, so the table body is unchanged.
- The existing test seeds drafts and asserts rows render; it must still pass. Those tests render `ContentList` under `DataProvider`/`ServicesProvider` — they will now also need `IndexProvider` (and `DeployProvider`) in the wrapper. Update the test render helper to wrap with `DeployProvider` + `IndexProvider`, and `await` the index build (the rows appear after `ensureBuilt`, so assertions already use `findBy*`).
- Keep the existing empty-state and `New {noun}` header.

- [ ] **Step 1: Write/extend the failing test**

```tsx
// in apps/admin/test/content-list.test.tsx — update the render helper and add a pagination test.
// Replace renderList's wrapper with:
//   <MemoryRouter><ServicesProvider services={servicesFor(adapter, createMemoryGitPort())}>
//     <DeployProvider><IndexProvider><ContentList .../></IndexProvider></DeployProvider>
//   </ServicesProvider></MemoryRouter>
// (import ServicesProvider, servicesFor, DeployProvider, IndexProvider; drop DataProvider if now unused)

it('paginates: shows page size and advances with Next', async () => {
  const many: DraftInput[] = Array.from({ length: 30 }, (_, i) => ({
    collection: 'post', locale: 'en', slug: `p${i}`, content: doc('x'),
    metadata: { title: `Post ${String(i).padStart(2, '0')}` },
  }))
  renderList(createMemoryDataPort(many), 'post', 'Posts')
  expect(await screen.findByText(/1–25 of 30/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /next/i }))
  expect(await screen.findByText(/26–30 of 30/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && pnpm test content-list`
Expected: FAIL — no pagination text / `useIndex` not used yet.

- [ ] **Step 3: Implement the migration**

```tsx
// apps/admin/src/screens/ContentList.tsx — replace the data-loading effect + add pagination.
// Key changes (keep PageHeader, table markup, StatusPill, lifecycleLabel, siteUrl as-is):
import { useEffect, useState } from 'react'
import type { ContentRow } from '@setu/core'
import { useIndex } from '../data/index-store'
// ...existing imports (Link, lifecycleLabel, PageHeader, StatusPill, Icon, siteUrl)...

const PAGE_SIZE = 25

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const index = useIndex()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      await index.ensureBuilt()
      const r = await index.query({
        collection, offset: page * PAGE_SIZE, limit: PAGE_SIZE,
        sort: { key: 'updatedAt', dir: 'desc' },
      })
      if (live) { setRows(r.rows); setTotal(r.total) }
    })()
    return () => { live = false }
  }, [index, collection, page])

  // ...render PageHeader (unchanged) + the table over `rows` (unchanged body)...
  // Add below the table, when total > 0:
  //   const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  //   const to = Math.min(total, (page + 1) * PAGE_SIZE)
  //   <div className="list-pager">
  //     <span className="ctable-muted">{from}–{to} of {total}</span>
  //     <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
  //     <button className="btn btn-sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next">Next</button>
  //   </div>
}
```

The table body (rows.map → `<tr>` with title `<Link>`, `StatusPill`, locale, updated date) is copied unchanged from the current implementation. Add minimal `.list-pager` styling to `apps/admin/src/styles/shell.css` (or `components.css`): `display:flex; gap:var(--space-2); align-items:center; justify-content:flex-end; margin-top:var(--space-3)`.

- [ ] **Step 4: Run tests**

Run: `cd apps/admin && pnpm test content-list`
Expected: PASS — existing row/empty-state assertions + the new pagination test.
Run: `cd apps/admin && pnpm test` and `pnpm typecheck`
Expected: full suite green, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens/ContentList.tsx apps/admin/test/content-list.test.tsx apps/admin/src/styles/shell.css
git commit -m "feat(admin): ContentList backed by the index + pagination"
```

---

## Self-Review

**Spec coverage:**
- Persisted index of projection rows → Tasks 1, 4, 5. ✅
- Paginated `query(...) → {rows,total}` contract → Tasks 1, 2 (`runQuery`), 6 (`IndexService.query`). ✅
- `IndexPort` (not extending `DataPort`) → Task 1. ✅
- Store-derived `status` + deploy as bulk-invalidation → Task 1 (`status` stored), Task 7 (`reindexAfterDeploy = rebuild`), Task 8 (deploy-sha effect). ✅
- Reuse `listContentEntries` → Tasks 6, 7. ✅
- Cold build + incremental on actions → Task 6 (`rebuild`/`ensureBuilt`), Task 7 (`reindexEntry`), Task 8 (save/publish/deploy wiring). ✅
- memory + idb adapters + shared contract → Tasks 3, 4, 5. ✅
- `ContentList` migration + pagination → Task 9. ✅
- Entity-agnostic contract for media reuse → Task 1 types (no content-specific fields beyond the projection). ✅
- Deferred (Slice 2 / Spec B): external reconciliation, `GitPort.diff`, sqlite/API adapters, rich findability UI, author column, bulk actions — none built. ✅

**Placeholder scan:** Tasks 1–7 contain complete code. Tasks 8–9 are integration tasks: the provider/effect code is complete; the two spots needing in-repo confirmation (where `DeployProvider` is mounted; the exact `EditorScreen` save/publish call sites and the table-body copy) are called out explicitly with how to find them, mirroring the codebase's existing patterns rather than inventing signatures.

**Type consistency:** `EntryIndexRow`/`IndexQuery`/`IndexPort`/`IndexService`/`IndexServiceDeps`/`INDEX_VERSION` names and shapes are identical across Tasks 1–8. `projectRow`/`rowToContentRow`/`indexKey`/`runQuery`/`createIndexService`/`createMemoryIndexPort`/`createIdbIndexPort` are defined once and consumed with matching signatures. `query` returns `EntryIndexRow[]` at the port layer (Tasks 4/5) and `ContentRow[]` at the service layer (Task 6) — the boundary is explicit and bridged by `rowToContentRow`.
