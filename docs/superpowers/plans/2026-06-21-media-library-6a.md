# Media Library (6A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browsable `/media` library (grid/search/sort/upload/delete) plus an editor "pick or upload" flow, so images can be found and reused instead of re-uploaded.

**Architecture:** A browser-side media index reuses the content-index infrastructure (idb + a pure query engine), hydrated from a raw "enumerate media" feed the API exposes from storage. Every upload writes a small JSON **media-record sidecar** (`<mediaKey>.media.json`) so the feed has real filename / timestamp / dimensions without re-parsing manifests. "Where-used" is a reference projection extracted from each post body during content indexing.

**Tech Stack:** TypeScript, Vitest, Hono (API), React + React Router + Tiptap (admin), IndexedDB (`idb`), `react-dropzone` (upload ergonomics), Sharp (existing image ingest).

## Spec

Source: `docs/superpowers/specs/2026-06-21-media-library-6a-design.md`.

### Implementation refinements discovered during planning (deltas from spec)

These do not change the user-facing design; they make it buildable:

1. **Media-record sidecar.** Manifests don't persist the original filename or an upload timestamp, and non-image uploads have no manifest at all. So each upload writes `<mediaKey>.media.json` (a `MediaRecord`) carrying `key`, `thumbKey`, `filename`, `contentType`, `isImage`, `width`, `height`, `bytes`, `uploadedAt`. The raw feed reads these sidecars — uniform for images and non-images, real timestamps for "Newest" sort.
2. **Separate idb database for the media index** (`setu-media-index`), not a new object store in the content-index DB — avoids cross-port `openDB` version coordination. Still reuses the `db-idb` package + `openDB` pattern (the reuse intent).
3. **`filename`** = the original upload `file.name` (now persisted in the sidecar).

## Global Constraints

- **Cloudflare-Pages / edge compatible.** No request-time dependency on a persistent local filesystem; topology-specific behaviour hides behind a port. Core packages compile under `tsconfig.edge.json` (no Node/DOM types) — pure helpers only; Node APIs live in `apps/api` / `storage-local`.
- **Cost-safe.** No per-request fan-out over storage in the hot path. The raw feed is the rebuild path, not per-keystroke.
- **Reuse before build.** Mirror `IndexPort` / `runQuery` / `db-idb` / `db-memory` / `runIndexPortContract`. Use `react-dropzone` for upload only. Build the grid mirroring `ContentList`.
- **UX is part of done.** Type-ahead search, drag-anywhere upload, clear empty/error/loading states, controls consistent with the rest of the admin.
- **Content-safety.** Deleting media surfaces a truthful "where-used" warning first.
- **Commit trailer (every commit):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Test runner:** Vitest. Core tests: `pnpm --filter @setu/core test`. Run a single file with `pnpm --filter <pkg> exec vitest run <path>`.

---

## File Structure

**Create:**
- `packages/core/src/media-index/types.ts` — `MediaRecord`, `MediaIndexRow`, `MediaIndexQuery`, `MediaSortKey`, `MediaIndexMeta`, `MediaIndexPort`, `mediaRowFromRecord`
- `packages/core/src/media-index/run-media-query.ts` — pure `runMediaQuery`
- `packages/core/src/media-index/media-index-service.ts` — `createMediaIndexService`, `MediaIndexService`, `MEDIA_INDEX_VERSION`
- `packages/core/src/content-index/extract-media-refs.ts` — pure `extractMediaRefs`
- `packages/core/src/index-port/referenced-by.ts` — pure `selectReferencedBy`
- `packages/db-idb/src/media-index-port.ts` — `createIdbMediaIndexPort`
- `packages/db-memory/src/media-index-port.ts` — `createMemoryMediaIndexPort`
- `apps/admin/src/media/MediaDropzone.tsx` — react-dropzone wrapper
- `apps/admin/src/media/media-client.ts` — `fetchMediaIndex`, `deleteMedia`
- `apps/admin/src/media/MediaGrid.tsx` — shared grid (manage/pick)
- `apps/admin/src/data/media-index-store.tsx` — `MediaIndexProvider`, `useMediaIndex`
- `apps/admin/src/editor/MediaPickerModal.tsx` — editor pick-or-upload modal
- Test files alongside each (see tasks).

**Modify:**
- `packages/core/src/storage/storage-port.ts` — add `list`
- `packages/storage-local/src/index.ts` — implement `list`
- `packages/core/src/image/media-key.ts` — add `mediaRecordKey`
- `packages/core/src/index-port/types.ts` — `mediaRefs` on `EntryIndexRow`; `referencedBy` on `IndexPort`; project it
- `packages/core/src/content-index/list-entries.ts` — `mediaRefs` on `ContentRow`
- `packages/core/src/index-port/index-service.ts` — `INDEX_VERSION` 3→4; delegate `referencedBy`
- `packages/core/src/index.ts` — barrel exports
- `packages/db-idb/src/index-port.ts`, `packages/db-memory/src/index-port.ts` — `referencedBy`
- `packages/db-idb/src/index.ts`, `packages/db-memory/src/index.ts` — barrels
- `packages/db-testing/src/index.ts` — `irow` default `mediaRefs`; `referencedBy` contract test; new `runMediaIndexPortContract`
- `apps/api/src/media.ts` — write sidecar on upload; `GET /media/_index`; `DELETE /media/*`
- `apps/admin/src/editor/image-insert.ts` — `imageBlockFromSrc` helper
- `apps/admin/src/editor/blocks.ts` — slash `/image` opens the picker modal
- `apps/admin/src/screens/Media.tsx` — full library screen
- `apps/admin/src/data/store.tsx`, `apps/admin/src/data/Bootstrap.tsx` — wire media index
- `apps/admin/package.json` — add `react-dropzone`

---

## Shared type contract (used across tasks)

```ts
// packages/core/src/media-index/types.ts
export interface MediaRecord {
  mediaKey: string          // '2026/06/cat'
  key: string               // original storage key '2026/06/cat.jpg' → src is `/media/${key}`
  thumbKey: string | null   // smallest variant key for the grid thumb; null for non-images
  filename: string          // original upload file.name
  contentType: string
  isImage: boolean
  width: number | null
  height: number | null
  bytes: number
  uploadedAt: number        // epoch ms
}
export interface MediaIndexRow extends MediaRecord {
  filenameLower: string     // search helper
}
export type MediaSortKey = 'uploadedAt' | 'filename' | 'bytes'
export interface MediaIndexQuery {
  q?: string
  type?: 'image' | 'all'
  sort?: { key: MediaSortKey; dir: 'asc' | 'desc' }
  offset: number
  limit: number
}
export interface MediaIndexMeta { version: number }
export interface MediaIndexPort {
  query(q: MediaIndexQuery): Promise<{ rows: MediaIndexRow[]; total: number }>
  upsert(row: MediaIndexRow): Promise<void>
  upsertMany(rows: MediaIndexRow[]): Promise<void>
  remove(mediaKey: string): Promise<void>
  clear(): Promise<void>
  getMeta(): Promise<MediaIndexMeta>
  setMeta(meta: MediaIndexMeta): Promise<void>
}
export function mediaRowFromRecord(rec: MediaRecord): MediaIndexRow {
  return { ...rec, filenameLower: rec.filename.toLowerCase() }
}
```

---

### Task 1: `StoragePort.list()` + local adapter

**Files:**
- Modify: `packages/core/src/storage/storage-port.ts`
- Modify: `packages/storage-local/src/index.ts`
- Test: `packages/storage-local/test/list.test.ts` (create)

**Interfaces:**
- Produces: `StoragePort.list(prefix?: string): Promise<string[]>` — returns storage keys (forward-slash, no leading slash), excluding the `.meta` namespace.

- [ ] **Step 1: Write the failing test**

```ts
// packages/storage-local/test/list.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '../src/index'

async function tmp() { return mkdtemp(join(tmpdir(), 'setu-list-')) }

describe('StoragePort.list (local)', () => {
  it('lists all keys recursively, excludes .meta, honours prefix', async () => {
    const dir = await tmp()
    try {
      const s = createLocalStorage({ dir, baseUrl: 'http://t/media' })
      await s.put('2026/06/cat.jpg', new Uint8Array([1]), { contentType: 'image/jpeg' })
      await s.put('2026/06/cat.media.json', new Uint8Array([2]), { contentType: 'application/json' })
      await s.put('2026/05/dog.png', new Uint8Array([3]), { contentType: 'image/png' })
      const all = (await s.list()).sort()
      expect(all).toEqual(['2026/05/dog.png', '2026/06/cat.jpg', '2026/06/cat.media.json'])
      // .meta sidecars (written by put for content-type) are not surfaced
      expect(all.some((k) => k.startsWith('.meta'))).toBe(false)
      const june = (await s.list('2026/06/')).sort()
      expect(june).toEqual(['2026/06/cat.jpg', '2026/06/cat.media.json'])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('returns [] for an empty store', async () => {
    const dir = await tmp()
    try { expect(await createLocalStorage({ dir, baseUrl: 'http://t' }).list()).toEqual([]) }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`list` is not a function)

Run: `pnpm --filter @setu/storage-local exec vitest run test/list.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `list` to the port type**

In `packages/core/src/storage/storage-port.ts`, inside `interface StoragePort`, after `url`:
```ts
  /** List storage keys (optionally under `prefix`). Excludes adapter-internal
   *  namespaces (e.g. `.meta`). Keys use forward slashes, no leading slash. */
  list(prefix?: string): Promise<string[]>
```

- [ ] **Step 4: Implement in storage-local**

In `packages/storage-local/src/index.ts`, add imports `readdir` to the `node:fs/promises` import and `relative` to `node:path`:
```ts
import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises'
import { dirname, join, normalize, sep, isAbsolute, relative } from 'node:path'
```
Add this method to the returned object (after `url`):
```ts
    async list(prefix?: string): Promise<string[]> {
      const root = normalize(dir)
      const out: string[] = []
      async function walk(abs: string): Promise<void> {
        let entries
        try { entries = await readdir(abs, { withFileTypes: true }) }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
        for (const ent of entries) {
          if (ent.name === META) continue // skip the content-type sidecar namespace
          const child = join(abs, ent.name)
          if (ent.isDirectory()) await walk(child)
          else out.push(relative(root, child).split(sep).join('/'))
        }
      }
      await walk(root)
      return prefix ? out.filter((k) => k.startsWith(prefix)) : out
    }
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @setu/storage-local exec vitest run test/list.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/storage-port.ts packages/storage-local/src/index.ts packages/storage-local/test/list.test.ts
git commit -m "feat(storage): add StoragePort.list + local recursive impl

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Media-index core types + `runMediaQuery` + `mediaRecordKey`

**Files:**
- Create: `packages/core/src/media-index/types.ts`
- Create: `packages/core/src/media-index/run-media-query.ts`
- Modify: `packages/core/src/image/media-key.ts` (add `mediaRecordKey`)
- Modify: `packages/core/src/index.ts` (barrel)
- Test: `packages/core/src/media-index/run-media-query.test.ts` (create)
- Test: `packages/core/test/media-key.test.ts` (add a case if the file exists; else create)

**Interfaces:**
- Produces: the full Shared Type Contract above; `runMediaQuery(rows, q)`; `mediaRecordKey(mediaKey) => '<mediaKey>.media.json'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/media-index/run-media-query.test.ts
import { describe, it, expect } from 'vitest'
import { runMediaQuery } from './run-media-query'
import type { MediaIndexRow } from './types'

const row = (o: Partial<MediaIndexRow>): MediaIndexRow => ({
  mediaKey: o.mediaKey ?? 'k', key: o.key ?? 'k.jpg', thumbKey: o.thumbKey ?? null,
  filename: o.filename ?? 'f.jpg', filenameLower: (o.filename ?? 'f.jpg').toLowerCase(),
  contentType: o.contentType ?? 'image/jpeg', isImage: o.isImage ?? true,
  width: o.width ?? null, height: o.height ?? null, bytes: o.bytes ?? 0, uploadedAt: o.uploadedAt ?? 0,
})

describe('runMediaQuery', () => {
  it('defaults to uploadedAt desc and paginates with total', () => {
    const rows = [row({ mediaKey: 'a', uploadedAt: 1 }), row({ mediaKey: 'b', uploadedAt: 3 }), row({ mediaKey: 'c', uploadedAt: 2 })]
    const r = runMediaQuery(rows, { offset: 0, limit: 2 })
    expect(r.total).toBe(3)
    expect(r.rows.map((x) => x.mediaKey)).toEqual(['b', 'c'])
  })
  it('filters by type=image', () => {
    const rows = [row({ mediaKey: 'img', isImage: true }), row({ mediaKey: 'doc', isImage: false })]
    expect(runMediaQuery(rows, { type: 'image', offset: 0, limit: 10 }).rows.map((x) => x.mediaKey)).toEqual(['img'])
  })
  it('filters by filename substring (case-insensitive)', () => {
    const rows = [row({ mediaKey: 'a', filename: 'Sunset.jpg' }), row({ mediaKey: 'b', filename: 'cat.png' })]
    expect(runMediaQuery(rows, { q: 'SUN', offset: 0, limit: 10 }).rows.map((x) => x.mediaKey)).toEqual(['a'])
  })
  it('sorts by filename asc and bytes desc', () => {
    const rows = [row({ mediaKey: 'a', filename: 'b.jpg', bytes: 10 }), row({ mediaKey: 'b', filename: 'a.jpg', bytes: 30 })]
    expect(runMediaQuery(rows, { sort: { key: 'filename', dir: 'asc' }, offset: 0, limit: 10 }).rows.map((x) => x.mediaKey)).toEqual(['b', 'a'])
    expect(runMediaQuery(rows, { sort: { key: 'bytes', dir: 'desc' }, offset: 0, limit: 10 }).rows.map((x) => x.mediaKey)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `pnpm --filter @setu/core exec vitest run src/media-index/run-media-query.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `types.ts`** — paste the entire Shared Type Contract block above into `packages/core/src/media-index/types.ts`.

- [ ] **Step 4: Create `run-media-query.ts`**

```ts
// packages/core/src/media-index/run-media-query.ts
import type { MediaIndexRow, MediaIndexQuery, MediaSortKey } from './types'

function compare(a: MediaIndexRow, b: MediaIndexRow, key: MediaSortKey): number {
  if (key === 'filename') return a.filenameLower.localeCompare(b.filenameLower)
  if (key === 'bytes') return a.bytes - b.bytes
  return a.uploadedAt - b.uploadedAt
}

export function runMediaQuery(
  rows: MediaIndexRow[],
  q: MediaIndexQuery,
): { rows: MediaIndexRow[]; total: number } {
  let xs = rows
  if (q.type === 'image') xs = xs.filter((r) => r.isImage)
  if (q.q && q.q.length > 0) {
    const needle = q.q.toLowerCase()
    xs = xs.filter((r) => r.filenameLower.includes(needle))
  }
  const sort = q.sort ?? { key: 'uploadedAt' as MediaSortKey, dir: 'desc' as const }
  const sorted = [...xs].sort((a, b) => {
    const c = compare(a, b, sort.key)
    return sort.dir === 'asc' ? c : -c
  })
  return { rows: sorted.slice(q.offset, q.offset + q.limit), total: sorted.length }
}
```

- [ ] **Step 5: Add `mediaRecordKey`** to `packages/core/src/image/media-key.ts` (after `manifestKey`):
```ts
/** Storage key of the per-upload media-record sidecar: `${mediaKey}.media.json`. */
export function mediaRecordKey(mediaKey: string): string {
  return `${mediaKey}.media.json`
}
```

- [ ] **Step 6: Barrel exports** — add to `packages/core/src/index.ts`:
```ts
export type { MediaRecord, MediaIndexRow, MediaSortKey, MediaIndexQuery, MediaIndexMeta, MediaIndexPort } from './media-index/types'
export { mediaRowFromRecord } from './media-index/types'
export { runMediaQuery } from './media-index/run-media-query'
```
And extend the existing `media-key` export line to include `mediaRecordKey`:
```ts
export { mediaSlug, mediaKeyOf, originalKey, variantKey, manifestKey, mediaRecordKey } from './image/media-key'
```

- [ ] **Step 7: Run tests — expect PASS**

Run: `pnpm --filter @setu/core exec vitest run src/media-index/run-media-query.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/media-index packages/core/src/image/media-key.ts packages/core/src/index.ts
git commit -m "feat(core): media-index types, runMediaQuery, mediaRecordKey

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `runMediaIndexPortContract` test harness

**Files:**
- Modify: `packages/db-testing/src/index.ts`

**Interfaces:**
- Consumes: `MediaIndexPort`, `MediaIndexRow` from `@setu/core`.
- Produces: `runMediaIndexPortContract(makeAdapter)` — the shared behavioural contract every media-index adapter must pass.

- [ ] **Step 1: Append the harness** to `packages/db-testing/src/index.ts`

Add `MediaIndexPort, MediaIndexRow` to the existing `import type { … } from '@setu/core'` line, then append:
```ts
const mrow = (over: Partial<MediaIndexRow>): MediaIndexRow => {
  const base = {
    mediaKey: '2026/06/x', key: '2026/06/x.jpg', thumbKey: null as string | null,
    filename: 'x.jpg', contentType: 'image/jpeg', isImage: true,
    width: null as number | null, height: null as number | null, bytes: 0, uploadedAt: 0,
    ...over,
  }
  return { ...base, filenameLower: base.filename.toLowerCase() }
}

export function runMediaIndexPortContract(makeAdapter: () => Promise<MediaIndexPort> | MediaIndexPort): void {
  describe('MediaIndexPort contract', () => {
    let ix: MediaIndexPort
    beforeEach(async () => { ix = await makeAdapter() })

    it('upserts and queries back a row', async () => {
      await ix.upsert(mrow({ mediaKey: 'a', filename: 'Alpha.jpg' }))
      const r = await ix.query({ offset: 0, limit: 10 })
      expect(r.total).toBe(1)
      expect(r.rows[0]!.mediaKey).toBe('a')
    })
    it('upsertMany, sorts uploadedAt desc, paginates with total', async () => {
      await ix.upsertMany([mrow({ mediaKey: 'a', uploadedAt: 1 }), mrow({ mediaKey: 'b', uploadedAt: 3 }), mrow({ mediaKey: 'c', uploadedAt: 2 })])
      const r = await ix.query({ offset: 0, limit: 2 })
      expect(r.total).toBe(3)
      expect(r.rows.map((x) => x.mediaKey)).toEqual(['b', 'c'])
    })
    it('filters by type=image', async () => {
      await ix.upsertMany([mrow({ mediaKey: 'img', isImage: true }), mrow({ mediaKey: 'doc', isImage: false })])
      const r = await ix.query({ type: 'image', offset: 0, limit: 10 })
      expect(r.rows.map((x) => x.mediaKey)).toEqual(['img'])
    })
    it('remove and clear', async () => {
      await ix.upsertMany([mrow({ mediaKey: 'a' }), mrow({ mediaKey: 'b' })])
      await ix.remove('a')
      expect((await ix.query({ offset: 0, limit: 10 })).total).toBe(1)
      await ix.clear()
      expect((await ix.query({ offset: 0, limit: 10 })).total).toBe(0)
    })
    it('meta round-trips and defaults to version 0', async () => {
      expect(await ix.getMeta()).toEqual({ version: 0 })
      await ix.setMeta({ version: 2 })
      expect(await ix.getMeta()).toEqual({ version: 2 })
    })
  })
}
```

- [ ] **Step 2: Verify it compiles** (no adapter yet, so no runnable test here)

Run: `pnpm --filter @setu/db-testing exec tsc --noEmit` (or the package's typecheck script)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db-testing/src/index.ts
git commit -m "test(db-testing): runMediaIndexPortContract harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: idb + memory MediaIndexPort adapters

**Files:**
- Create: `packages/db-idb/src/media-index-port.ts`, `packages/db-memory/src/media-index-port.ts`
- Modify: `packages/db-idb/src/index.ts`, `packages/db-memory/src/index.ts` (barrels)
- Test: `packages/db-idb/test/media-index-contract.test.ts`, `packages/db-memory/test/media-index-contract.test.ts`

**Interfaces:**
- Consumes: `MediaIndexPort`, `MediaIndexRow`, `runMediaQuery`; `runMediaIndexPortContract`.
- Produces: `createIdbMediaIndexPort(dbName?)`, `createMemoryMediaIndexPort()`.

- [ ] **Step 1: Write the failing contract tests**

```ts
// packages/db-idb/test/media-index-contract.test.ts
import 'fake-indexeddb/auto'
import { runMediaIndexPortContract } from '@setu/db-testing'
import { createIdbMediaIndexPort } from '../src/index'
let n = 0
runMediaIndexPortContract(() => createIdbMediaIndexPort(`setu-media-index-test-${n++}`))
```
```ts
// packages/db-memory/test/media-index-contract.test.ts
import { runMediaIndexPortContract } from '@setu/db-testing'
import { createMemoryMediaIndexPort } from '../src/index'
runMediaIndexPortContract(() => createMemoryMediaIndexPort())
```

- [ ] **Step 2: Run — expect FAIL** (creators not exported)

Run: `pnpm --filter @setu/db-memory exec vitest run test/media-index-contract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the memory adapter** (mirror `db-memory/src/index-port.ts`)

```ts
// packages/db-memory/src/media-index-port.ts
import type { MediaIndexRow, MediaIndexMeta, MediaIndexPort, MediaIndexQuery } from '@setu/core'
import { runMediaQuery } from '@setu/core'

export function createMemoryMediaIndexPort(): MediaIndexPort {
  const rows = new Map<string, MediaIndexRow>()
  let meta: MediaIndexMeta = { version: 0 }
  return {
    async query(q: MediaIndexQuery) { return runMediaQuery([...rows.values()], q) },
    async upsert(row) { rows.set(row.mediaKey, structuredClone(row)) },
    async upsertMany(rs) { for (const r of rs) rows.set(r.mediaKey, structuredClone(r)) },
    async remove(mediaKey) { rows.delete(mediaKey) },
    async clear() { rows.clear() },
    async getMeta() { return { ...meta } },
    async setMeta(m) { meta = { ...m } },
  }
}
```

- [ ] **Step 4: Implement the idb adapter** (mirror `db-idb/src/index-port.ts`; OWN database)

```ts
// packages/db-idb/src/media-index-port.ts
import { openDB } from 'idb'
import type { MediaIndexRow, MediaIndexMeta, MediaIndexPort } from '@setu/core'
import { runMediaQuery } from '@setu/core'

/** IndexedDB-backed MediaIndexPort. Own DB (no version coordination with the
 *  content index). Rows are tiny; query loads the store + delegates to the shared
 *  pure runMediaQuery (same pattern as createIdbIndexPort). */
export async function createIdbMediaIndexPort(dbName = 'setu-media-index'): Promise<MediaIndexPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) { d.createObjectStore('media'); d.createObjectStore('meta') },
  })
  return {
    async query(q) { return runMediaQuery((await db.getAll('media')) as MediaIndexRow[], q) },
    async upsert(row) { await db.put('media', row, row.mediaKey) },
    async upsertMany(rows) {
      const tx = db.transaction('media', 'readwrite')
      await Promise.all([...rows.map((r) => tx.store.put(r, r.mediaKey)), tx.done])
    },
    async remove(mediaKey) { await db.delete('media', mediaKey) },
    async clear() { await db.clear('media') },
    async getMeta() { return ((await db.get('meta', 'meta')) as MediaIndexMeta | undefined) ?? { version: 0 } },
    async setMeta(m) { await db.put('meta', m, 'meta') },
  }
}
```

- [ ] **Step 5: Export from barrels**

`packages/db-idb/src/index.ts`: add `export { createIdbMediaIndexPort } from './media-index-port'`
`packages/db-memory/src/index.ts`: add `export { createMemoryMediaIndexPort } from './media-index-port'`

- [ ] **Step 6: Run both — expect PASS**

Run: `pnpm --filter @setu/db-memory exec vitest run test/media-index-contract.test.ts && pnpm --filter @setu/db-idb exec vitest run test/media-index-contract.test.ts`
Expected: PASS (5 tests each).

- [ ] **Step 7: Commit**

```bash
git add packages/db-idb/src/media-index-port.ts packages/db-idb/src/index.ts packages/db-idb/test/media-index-contract.test.ts packages/db-memory/src/media-index-port.ts packages/db-memory/src/index.ts packages/db-memory/test/media-index-contract.test.ts
git commit -m "feat(db): idb + memory MediaIndexPort adapters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `createMediaIndexService`

**Files:**
- Create: `packages/core/src/media-index/media-index-service.ts`
- Modify: `packages/core/src/index.ts` (barrel)
- Test: `packages/core/src/media-index/media-index-service.test.ts`

**Interfaces:**
- Consumes: `MediaIndexPort`, `MediaRecord`, `mediaRowFromRecord`.
- Produces: `MediaIndexService { ensureBuilt(); refresh(); rebuild(); query(q); upsertOne(rec); removeOne(mediaKey) }`, `createMediaIndexService({ mediaIndex, fetchRaw })`, `MEDIA_INDEX_VERSION = 1`. `fetchRaw: () => Promise<MediaRecord[]>` is injected so core stays edge-safe (no HTTP).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/media-index/media-index-service.test.ts
import { describe, it, expect } from 'vitest'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { createMediaIndexService } from './media-index-service'
import type { MediaRecord } from './types'

const rec = (mediaKey: string, over: Partial<MediaRecord> = {}): MediaRecord => ({
  mediaKey, key: `${mediaKey}.jpg`, thumbKey: null, filename: `${mediaKey}.jpg`,
  contentType: 'image/jpeg', isImage: true, width: null, height: null, bytes: 0, uploadedAt: 0, ...over,
})

describe('createMediaIndexService', () => {
  it('ensureBuilt hydrates from fetchRaw once; not again when version matches', async () => {
    let calls = 0
    const ix = createMemoryMediaIndexPort()
    const svc = createMediaIndexService({ mediaIndex: ix, fetchRaw: async () => { calls++; return [rec('a')] } })
    await svc.ensureBuilt()
    await svc.ensureBuilt()
    expect(calls).toBe(1)
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(1)
  })
  it('refresh re-hydrates (clear + repopulate) every call', async () => {
    let batch: MediaRecord[] = [rec('a'), rec('b')]
    const svc = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => batch })
    await svc.refresh()
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(2)
    batch = [rec('a')] // 'b' deleted elsewhere
    await svc.refresh()
    expect((await svc.query({ offset: 0, limit: 10 })).rows.map((r) => r.mediaKey)).toEqual(['a'])
  })
  it('upsertOne / removeOne mutate optimistically', async () => {
    const svc = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => [] })
    await svc.ensureBuilt()
    await svc.upsertOne(rec('new'))
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(1)
    await svc.removeOne('new')
    expect((await svc.query({ offset: 0, limit: 10 })).total).toBe(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @setu/core exec vitest run src/media-index/media-index-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

```ts
// packages/core/src/media-index/media-index-service.ts
import type { MediaIndexPort, MediaIndexQuery, MediaRecord } from './types'
import { mediaRowFromRecord } from './types'

export const MEDIA_INDEX_VERSION = 1

export interface MediaIndexService {
  ensureBuilt(): Promise<void>
  refresh(): Promise<void>
  rebuild(): Promise<void>
  query(q: MediaIndexQuery): Promise<{ rows: import('./types').MediaIndexRow[]; total: number }>
  upsertOne(rec: MediaRecord): Promise<void>
  removeOne(mediaKey: string): Promise<void>
}

export interface MediaIndexServiceDeps {
  mediaIndex: MediaIndexPort
  fetchRaw: () => Promise<MediaRecord[]>
}

export function createMediaIndexService({ mediaIndex, fetchRaw }: MediaIndexServiceDeps): MediaIndexService {
  async function rebuild(): Promise<void> {
    const recs = await fetchRaw()
    await mediaIndex.clear()
    await mediaIndex.upsertMany(recs.map(mediaRowFromRecord))
    await mediaIndex.setMeta({ version: MEDIA_INDEX_VERSION })
  }
  async function ensureBuilt(): Promise<void> {
    const meta = await mediaIndex.getMeta()
    if (meta.version !== MEDIA_INDEX_VERSION) await rebuild()
  }
  return {
    ensureBuilt,
    rebuild,
    refresh: rebuild, // stale-while-revalidate: callers render cached rows first, then refresh()
    async query(q) { return mediaIndex.query(q) },
    async upsertOne(rec) { await mediaIndex.upsert(mediaRowFromRecord(rec)) },
    async removeOne(mediaKey) { await mediaIndex.remove(mediaKey) },
  }
}
```

- [ ] **Step 4: Barrel** — add to `packages/core/src/index.ts`:
```ts
export type { MediaIndexService, MediaIndexServiceDeps } from './media-index/media-index-service'
export { createMediaIndexService, MEDIA_INDEX_VERSION } from './media-index/media-index-service'
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @setu/core exec vitest run src/media-index/media-index-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/media-index/media-index-service.ts packages/core/src/media-index/media-index-service.test.ts packages/core/src/index.ts
git commit -m "feat(core): createMediaIndexService (rebuild/refresh/ensureBuilt/upsertOne/removeOne)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `extractMediaRefs` + `mediaRefs` content-index projection

**Files:**
- Create: `packages/core/src/content-index/extract-media-refs.ts`
- Modify: `packages/core/src/content-index/list-entries.ts` (add `mediaRefs` to `ContentRow` + compute)
- Modify: `packages/core/src/index-port/types.ts` (`mediaRefs` on `EntryIndexRow`; project in `projectRow`/`rowToContentRow`)
- Modify: `packages/core/src/index-port/index-service.ts` (`INDEX_VERSION` 3 → 4)
- Modify: `packages/core/src/index.ts` (export `extractMediaRefs`)
- Modify: `packages/db-testing/src/index.ts` (`irow` default `mediaRefs: []`)
- Test: `packages/core/src/content-index/extract-media-refs.test.ts`

**Interfaces:**
- Produces: `extractMediaRefs(body: string): string[]` — bare mediaKeys referenced by a serialized doc; `ContentRow.mediaRefs: string[]`; `EntryIndexRow.mediaRefs: string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/content-index/extract-media-refs.test.ts
import { describe, it, expect } from 'vitest'
import { extractMediaRefs } from './extract-media-refs'

describe('extractMediaRefs', () => {
  it('extracts from {% image %} blocks and inline markdown, normalizes to mediaKey', () => {
    const body = [
      '{% image src="/media/2026/06/cat.jpg" align="wide" /%}',
      '![a dog](/media/2026/05/dog.png)',
    ].join('\n')
    expect(extractMediaRefs(body).sort()).toEqual(['2026/05/dog', '2026/06/cat'])
  })
  it('strips a -<width>w variant suffix and dedupes', () => {
    const body = '/media/2026/06/cat-800w.webp /media/2026/06/cat.jpg'
    expect(extractMediaRefs(body)).toEqual(['2026/06/cat'])
  })
  it('returns [] when there are no media refs', () => {
    expect(extractMediaRefs('just text, no images')).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @setu/core exec vitest run src/content-index/extract-media-refs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `extractMediaRefs`**

```ts
// packages/core/src/content-index/extract-media-refs.ts
// Pure, edge-safe. Scans a serialized doc string for /media/<key> references
// (image blocks, inline images, frontmatter cover images — any embedded URL) and
// normalizes each to its bare mediaKey (no extension, no -<width>w variant suffix).
const MEDIA_REF = /\/media\/([A-Za-z0-9][A-Za-z0-9._/-]*)/g

function normalize(raw: string): string {
  return raw.replace(/\.[^./]+$/, '').replace(/-\d+w$/, '')
}

export function extractMediaRefs(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(MEDIA_REF)) out.add(normalize(m[1]!))
  return [...out]
}
```

- [ ] **Step 4: Thread `mediaRefs` through the content index**

In `packages/core/src/content-index/list-entries.ts`:
- import: `import { extractMediaRefs } from './extract-media-refs'`
- add to the `ContentRow` interface: `mediaRefs: string[]`
- in the `order.map(...)` return object (the one returning `{ ref, title, ... categories }`), add `mediaRefs: mediaRefsOf(draftStr, committedStr),`
- add this helper near `tagsOf`:
```ts
/** Media keys referenced by the live version (draft's serialized doc when a draft
 *  exists, else the committed file). Whole-doc scan catches body + frontmatter. */
function mediaRefsOf(draftStr: string | null, committedStr: string | null): string[] {
  const body = draftStr ?? committedStr
  return body ? extractMediaRefs(body) : []
}
```

In `packages/core/src/index-port/types.ts`:
- add `mediaRefs: string[]` to the `EntryIndexRow` interface (after `categories`)
- in `projectRow`, add `mediaRefs: row.mediaRefs,` to the `out` object
- in `rowToContentRow`, add `mediaRefs: r.mediaRefs,` to the returned object

In `packages/core/src/index-port/index-service.ts`: change `export const INDEX_VERSION = 3` to `= 4`.

In `packages/db-testing/src/index.ts`: in the `irow` `base` object add `mediaRefs: [] as string[],`.

- [ ] **Step 5: Export** — add to `packages/core/src/index.ts`:
```ts
export { extractMediaRefs } from './content-index/extract-media-refs'
```

- [ ] **Step 6: Run core + db tests — expect PASS** (the `INDEX_VERSION` bump and the new field must not break existing index tests)

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/db-memory test && pnpm --filter @setu/db-idb test`
Expected: PASS (incl. the 3 new extract-media-refs tests). If an existing snapshot/test hardcodes `EntryIndexRow` shape without `mediaRefs`, update it to include `mediaRefs: []`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/content-index packages/core/src/index-port/types.ts packages/core/src/index-port/index-service.ts packages/core/src/index.ts packages/db-testing/src/index.ts
git commit -m "feat(core): mediaRefs projection + extractMediaRefs (INDEX_VERSION 3->4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `referencedBy` query on the content index

**Files:**
- Create: `packages/core/src/index-port/referenced-by.ts`
- Modify: `packages/core/src/index-port/types.ts` (`referencedBy` on `IndexPort`)
- Modify: `packages/core/src/index-port/index-service.ts` (`IndexService.referencedBy` delegate)
- Modify: `packages/core/src/index.ts` (export `selectReferencedBy`, `MediaUsage`)
- Modify: `packages/db-idb/src/index-port.ts`, `packages/db-memory/src/index-port.ts`
- Modify: `packages/db-testing/src/index.ts` (contract test for `referencedBy`)

**Interfaces:**
- Produces: `MediaUsage = { collection: string; locale: string; slug: string; title: string }`; `IndexPort.referencedBy(mediaKey): Promise<MediaUsage[]>`; `selectReferencedBy(rows, mediaKey)`; `IndexService.referencedBy(mediaKey)`.

- [ ] **Step 1: Add a contract test** in `packages/db-testing/src/index.ts`, inside `runIndexPortContract`'s `describe`:
```ts
it('referencedBy: returns entries whose mediaRefs include the key', async () => {
  await ix.upsertMany([
    irow({ slug: 'a', title: 'A', mediaRefs: ['2026/06/cat'] }),
    irow({ slug: 'b', title: 'B', mediaRefs: ['2026/06/dog'] }),
    irow({ slug: 'c', title: 'C', mediaRefs: ['2026/06/cat', '2026/06/dog'] }),
  ])
  const used = await ix.referencedBy('2026/06/cat')
  expect(used.map((u) => u.slug).sort()).toEqual(['a', 'c'])
  expect(used[0]).toHaveProperty('title')
  expect(await ix.referencedBy('2026/06/none')).toEqual([])
})
```

- [ ] **Step 2: Run — expect FAIL** (`referencedBy` not a function)

Run: `pnpm --filter @setu/db-memory exec vitest run test/index-contract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Pure selector**

```ts
// packages/core/src/index-port/referenced-by.ts
import type { EntryIndexRow } from './types'

export interface MediaUsage { collection: string; locale: string; slug: string; title: string }

/** Entries whose mediaRefs include `mediaKey`. The shared impl for every adapter
 *  (cf. selectDistinctTags). */
export function selectReferencedBy(rows: EntryIndexRow[], mediaKey: string): MediaUsage[] {
  const out: MediaUsage[] = []
  for (const r of rows) {
    if (r.mediaRefs.includes(mediaKey)) out.push({ collection: r.collection, locale: r.locale, slug: r.slug, title: r.title })
  }
  return out
}
```

- [ ] **Step 4: Extend the port + adapters**

`packages/core/src/index-port/types.ts` — add to `IndexPort` (after `distinctLocales`):
```ts
  referencedBy(mediaKey: string): Promise<import('./referenced-by').MediaUsage[]>
```
`packages/db-idb/src/index-port.ts` — add to the imports `selectReferencedBy` and add the method:
```ts
    async referencedBy(mediaKey) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectReferencedBy(all, mediaKey)
    },
```
`packages/db-memory/src/index-port.ts` — import `selectReferencedBy`, add:
```ts
    async referencedBy(mediaKey) { return selectReferencedBy([...rows.values()], mediaKey) },
```

- [ ] **Step 5: Delegate from the service** — `packages/core/src/index-port/index-service.ts`:
- add `referencedBy(mediaKey: string): Promise<import('./referenced-by').MediaUsage[]>` to the `IndexService` interface
- add to the returned object: `async referencedBy(mediaKey) { return index.referencedBy(mediaKey) },`

- [ ] **Step 6: Export** — `packages/core/src/index.ts`:
```ts
export type { MediaUsage } from './index-port/referenced-by'
export { selectReferencedBy } from './index-port/referenced-by'
```

- [ ] **Step 7: Run — expect PASS**

Run: `pnpm --filter @setu/db-memory test && pnpm --filter @setu/db-idb test && pnpm --filter @setu/core test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index-port packages/core/src/index.ts packages/db-idb/src/index-port.ts packages/db-memory/src/index-port.ts packages/db-testing/src/index.ts
git commit -m "feat(core): IndexPort.referencedBy for media where-used

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: API — sidecar on upload, `GET /media/_index`, `DELETE /media/*`

**Files:**
- Modify: `apps/api/src/media.ts`
- Test: `apps/api/test/media-index.test.ts`, `apps/api/test/media-delete.test.ts`

**Interfaces:**
- Consumes: `mediaRecordKey`, `manifestKey`, `originalKey`, `MediaManifest`, `MediaRecord`, `StoragePort.list`.
- Produces: upload also writes `<mediaKey>.media.json` and returns `record` in its JSON; `GET /media/_index → { records: MediaRecord[] }`; `DELETE /media/* → { ok: true }` removing original + variants + manifest + record.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/media-index.test.ts
import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(k, b, o) { map.set(k, { body: b.slice(), contentType: o.contentType }) },
    async get(k) { const o = map.get(k); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(k) { map.delete(k) },
    async exists(k) { return map.has(k) },
    url(k) { return `http://test/media/${k}` },
    async list(prefix?) { const ks = [...map.keys()]; return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks },
  }
}
const owner: Actor = { id: 'local', role: 'owner' }

async function upload(app: ReturnType<typeof createUploadApi>, file: File) {
  const body = new FormData(); body.append('file', file)
  return app.fetch(new Request('http://test/media', { method: 'POST', body }))
}

describe('GET /media/_index', () => {
  it('returns a record per uploaded item (image + non-image)', async () => {
    const storage = memStorage()
    const app = createUploadApi({ storage, resolveActor: () => owner })
    await upload(app, new File([new Uint8Array([1])], 'Cat Photo.png', { type: 'image/png' }))
    await upload(app, new File([new Uint8Array([2, 3])], 'notes.pdf', { type: 'application/pdf' }))
    const res = await app.fetch(new Request('http://test/media/_index'))
    expect(res.status).toBe(200)
    const { records } = (await res.json()) as { records: { filename: string; isImage: boolean; bytes: number }[] }
    expect(records).toHaveLength(2)
    const pdf = records.find((r) => r.filename === 'notes.pdf')!
    expect(pdf.isImage).toBe(false)
    expect(pdf.bytes).toBe(2)
  })
})
```
```ts
// apps/api/test/media-delete.test.ts
import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

function memStorage() { /* identical to media-index.test.ts memStorage — copy it */ }

describe('DELETE /media/*', () => {
  it('removes the original and its media-record sidecar', async () => {
    // upload a non-image (no manifest needed), then DELETE its mediaKey, assert both keys gone.
    // Use the same memStorage + owner setup; after upload read `key`/`id` from the JSON.
    // Assert storage.exists(original) === false and exists('<mediaKey>.media.json') === false.
  })
})
```
> Implementer: flesh out `media-delete.test.ts` using the same `memStorage`/`owner`/`upload` helpers; upload `new File([...], 'a.pdf', { type: 'application/pdf' })`, parse `{ id, key }`, `DELETE http://test/media/${id}`, then assert `await storage.exists(key) === false` and `await storage.exists(`${id}.media.json`) === false`.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @setu/api exec vitest run test/media-index.test.ts`
Expected: FAIL (route 404 / missing record).

- [ ] **Step 3: Write the media-record sidecar on upload**

In `apps/api/src/media.ts`, extend the import to include `variantKey, mediaRecordKey` and the type `MediaRecord`:
```ts
import { createAuthz, DEFAULT_ROLES, ingestImage, mediaSlug, mediaKeyOf, originalKey, variantKey, manifestKey, mediaRecordKey } from '@setu/core'
import type { Actor, ImageFormat, ImagePort, MediaManifest, MediaRecord, StoragePort } from '@setu/core'
```
After the `manifest` is (maybe) produced and before the `return c.json(...)`, build + store the record:
```ts
    const isImage = file.type.startsWith('image/')
    const smallest = manifest?.variants.slice().sort((a, b) => a.width - b.width)[0]
    const record: MediaRecord = {
      mediaKey,
      key,
      thumbKey: smallest ? smallest.key : null,
      filename: file.name,
      contentType: file.type,
      isImage,
      width: manifest ? manifest.original.width : null,
      height: manifest ? manifest.original.height : null,
      bytes: file.size,
      uploadedAt: Date.now(),
    }
    await storage.put(mediaRecordKey(mediaKey), new TextEncoder().encode(JSON.stringify(record)), {
      contentType: 'application/json',
    })
```
Add `record` to the response object: `..., record,` (alongside `id`, `key`, …).

- [ ] **Step 4: Add `GET /media/_index`** — register it **before** `app.get('/media/*', …)` so the wildcard doesn't shadow it:
```ts
  app.get('/media/_index', async (c) => {
    const keys = await storage.list()
    const records: MediaRecord[] = []
    for (const k of keys) {
      if (!k.endsWith('.media.json')) continue
      const obj = await storage.get(k)
      if (!obj) continue
      try { records.push(JSON.parse(new TextDecoder().decode(obj.body)) as MediaRecord) } catch { /* skip corrupt */ }
    }
    return c.json({ records })
  })
```

- [ ] **Step 5: Add `DELETE /media/*`**

```ts
  app.delete('/media/*', authMiddleware(opts.resolveActor), async (c) => {
    // Reuse the upload gate for now (owner-only in practice); a dedicated
    // content.delete capability is a later refinement.
    if (!authz.can(c.get('actor'), 'content.create')) return c.json({ error: 'forbidden' }, 403)
    const mediaKey = decodeURIComponent(c.req.path.slice('/media/'.length))
    if (mediaKey.split('/').some((seg) => seg === '..' || seg === '')) return c.json({ error: 'not found' }, 404)

    const manRaw = await storage.get(manifestKey(mediaKey))
    if (manRaw) {
      const man = JSON.parse(new TextDecoder().decode(manRaw.body)) as MediaManifest
      await storage.delete(man.original.key)
      for (const v of man.variants) await storage.delete(v.key)
      await storage.delete(manifestKey(mediaKey))
    }
    const recRaw = await storage.get(mediaRecordKey(mediaKey))
    if (recRaw) {
      const rec = JSON.parse(new TextDecoder().decode(recRaw.body)) as MediaRecord
      await storage.delete(rec.key) // original (covers non-images with no manifest)
      await storage.delete(mediaRecordKey(mediaKey))
    }
    return c.json({ ok: true })
  })
```

- [ ] **Step 6: Run — expect PASS** (also run the existing media tests for regressions)

Run: `pnpm --filter @setu/api exec vitest run test/media-index.test.ts test/media-delete.test.ts test/media-upload.test.ts test/media-serve.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/media.ts apps/api/test/media-index.test.ts apps/api/test/media-delete.test.ts
git commit -m "feat(api): media-record sidecar, GET /media/_index, DELETE /media/*

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `react-dropzone` dependency + `MediaDropzone` wrapper

**Files:**
- Modify: `apps/admin/package.json` (add `react-dropzone`)
- Create: `apps/admin/src/media/MediaDropzone.tsx`
- Test: `apps/admin/test/media-dropzone.test.tsx`

**Interfaces:**
- Consumes: `uploadFile`, `UploadResult` from `../media/upload-client`.
- Produces: `<MediaDropzone apiBase onUploaded onError disabled? children? />` where `onUploaded(result: UploadResult)` fires per successfully uploaded file. `UploadResult` already carries `record` (Task 8 adds it) — update `UploadResult` in `upload-client.ts` to include `record: MediaRecord`.

- [ ] **Step 0: Install** — `cd apps/admin && pnpm add react-dropzone` (verify it lands in `dependencies`; from repo root re-run `pnpm install` if needed).

- [ ] **Step 1: Extend `UploadResult`** in `apps/admin/src/media/upload-client.ts` — add `record: import('@setu/core').MediaRecord` to the interface (the API now returns it).

- [ ] **Step 2: Write the failing test**

```tsx
// apps/admin/test/media-dropzone.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaDropzone } from '../src/media/MediaDropzone'
import type { UploadResult } from '../src/media/upload-client'

const result: UploadResult = {
  id: '2026/06/cat', key: '2026/06/cat.png', url: 'http://x/media/2026/06/cat.png',
  contentType: 'image/png', size: 1, filename: 'cat.png',
  record: { mediaKey: '2026/06/cat', key: '2026/06/cat.png', thumbKey: null, filename: 'cat.png', contentType: 'image/png', isImage: true, width: null, height: null, bytes: 1, uploadedAt: 0 },
}

describe('MediaDropzone', () => {
  it('uploads a dropped/selected file and calls onUploaded with the result', async () => {
    const upload = vi.fn(async () => result)
    const onUploaded = vi.fn()
    render(<MediaDropzone apiBase="http://x" onUploaded={onUploaded} upload={upload} />)
    const input = screen.getByTestId('media-dropzone-input') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(result))
    expect(upload).toHaveBeenCalledWith('http://x', file)
  })
})
```

- [ ] **Step 3: Implement** — `react-dropzone`'s `useDropzone` provides `getRootProps`/`getInputProps`. Accept an injectable `upload` (default `uploadFile`) for testing. The hidden input must carry `data-testid="media-dropzone-input"` (merge into `getInputProps()`):
```tsx
// apps/admin/src/media/MediaDropzone.tsx
import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { useDropzone } from 'react-dropzone'
import { uploadFile, type UploadResult } from './upload-client'

export interface MediaDropzoneProps {
  apiBase: string
  onUploaded: (result: UploadResult) => void
  onError?: (msg: string) => void
  onBusy?: (busy: boolean) => void
  disabled?: boolean
  children?: ReactNode
  upload?: typeof uploadFile
}

export function MediaDropzone({ apiBase, onUploaded, onError, onBusy, disabled, children, upload = uploadFile }: MediaDropzoneProps) {
  const onDrop = useCallback(async (files: File[]) => {
    onBusy?.(true)
    try {
      for (const file of files) onUploaded(await upload(apiBase, file))
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      onBusy?.(false)
    }
  }, [apiBase, onUploaded, onError, onBusy, upload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] }, disabled })

  return (
    <div {...getRootProps()} className="media-dropzone" data-drag-active={isDragActive ? '' : undefined}>
      <input {...getInputProps({ 'data-testid': 'media-dropzone-input' })} />
      {children ?? <p className="muted">Drag images here, or click to upload</p>}
    </div>
  )
}
```
> Note: `isDragActive` styling is CSS — assert the `data-drag-active` attribute in any visual test (jsdom ignores CSS; the #5b lesson).

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @setu/admin exec vitest run test/media-dropzone.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/package.json apps/admin/src/media/MediaDropzone.tsx apps/admin/src/media/upload-client.ts apps/admin/test/media-dropzone.test.tsx pnpm-lock.yaml
git commit -m "feat(admin): react-dropzone + MediaDropzone upload wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Admin media client + `useMediaIndex` wiring

**Files:**
- Create: `apps/admin/src/media/media-client.ts`
- Create: `apps/admin/src/data/media-index-store.tsx`
- Modify: `apps/admin/src/data/store.tsx`, `apps/admin/src/data/Bootstrap.tsx`
- Test: `apps/admin/test/media-client.test.ts`

**Reference:** mirror `apps/admin/src/data/index-store.tsx` (the `useIndex()` provider) — read it first; the media store is its twin over `MediaIndexService`.

**Interfaces:**
- Produces: `fetchMediaIndex(apiBase): Promise<MediaRecord[]>`, `deleteMedia(apiBase, mediaKey): Promise<void>`; `MediaIndexProvider`, `useMediaIndex(): MediaIndexService`; `Services.mediaIndex: MediaIndexService`.

- [ ] **Step 1: Write the failing test (client)**

```ts
// apps/admin/test/media-client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchMediaIndex, deleteMedia } from '../src/media/media-client'

afterEach(() => vi.restoreAllMocks())

describe('media-client', () => {
  it('fetchMediaIndex returns records', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records: [{ mediaKey: 'a' }] }), { status: 200 })))
    expect(await fetchMediaIndex('http://x')).toEqual([{ mediaKey: 'a' }])
  })
  it('deleteMedia DELETEs the mediaKey and throws on failure', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await deleteMedia('http://x', '2026/06/cat')
    expect(f).toHaveBeenCalledWith('http://x/media/2026/06/cat', { method: 'DELETE' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no"}', { status: 500 })))
    await expect(deleteMedia('http://x', 'k')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @setu/admin exec vitest run test/media-client.test.ts`

- [ ] **Step 3: Implement the client**

```ts
// apps/admin/src/media/media-client.ts
import type { MediaRecord } from '@setu/core'

export async function fetchMediaIndex(apiBase: string): Promise<MediaRecord[]> {
  const res = await fetch(`${apiBase}/media/_index`)
  if (!res.ok) throw new Error(`media index fetch failed (${res.status})`)
  return ((await res.json()) as { records: MediaRecord[] }).records
}

export async function deleteMedia(apiBase: string, mediaKey: string): Promise<void> {
  const res = await fetch(`${apiBase}/media/${mediaKey}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `delete failed (${res.status})`)
  }
}
```

- [ ] **Step 4: Implement the provider** (mirror `index-store.tsx`). Construct the service with `createMediaIndexService({ mediaIndex, fetchRaw: () => fetchMediaIndex(apiBase) })`. For the no-API/test path, `fetchRaw` returns `[]`. Expose `useMediaIndex()`.

```tsx
// apps/admin/src/data/media-index-store.tsx
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { MediaIndexService } from '@setu/core'

const Ctx = createContext<MediaIndexService | null>(null)
export function MediaIndexProvider({ service, children }: { service: MediaIndexService; children: ReactNode }) {
  return <Ctx.Provider value={service}>{children}</Ctx.Provider>
}
export function useMediaIndex(): MediaIndexService {
  const v = useContext(Ctx)
  if (v === null) throw new Error('useMediaIndex must be used within a MediaIndexProvider')
  return v
}
```

- [ ] **Step 5: Wire into Services + Bootstrap**

In `apps/admin/src/data/store.tsx`:
- import `createMediaIndexService`, `type MediaIndexService`, `type MediaIndexPort` from `@setu/core`; `createMemoryMediaIndexPort` from `@setu/db-memory`.
- add `mediaIndex: MediaIndexService` to the `Services` interface.
- extend `servicesFor(data, git, index?, opts?: { apiBase?: string; mediaIndex?: MediaIndexPort })`: build
  `const mediaIndex = createMediaIndexService({ mediaIndex: opts?.mediaIndex ?? createMemoryMediaIndexPort(), fetchRaw: opts?.apiBase ? () => fetchMediaIndex(opts.apiBase!) : async () => [] })`
  and include `mediaIndex` in the returned bundle. (Import `fetchMediaIndex` from `../media/media-client`.)
- if `bootstrapServices` exists as a separate function, thread the same `opts` through it.

In `apps/admin/src/data/Bootstrap.tsx`:
- in the `apiBase` branch, also `const mediaIndexPort = await createIdbMediaIndexPort()` (import from `@setu/db-idb`) and pass `{ apiBase, mediaIndex: mediaIndexPort }` as the new `opts` to `bootstrapServices`.
- in the idb fallback branch (no apiBase) pass `{ mediaIndex: await createIdbMediaIndexPort() }`.
- render the provider: wrap children with `<MediaIndexProvider service={services.mediaIndex}>` (alongside the existing `ServicesProvider`), or expose `mediaIndex` purely via `useServices().mediaIndex` and have `useMediaIndex` read from there — pick whichever matches how `index-store`/`useIndex` is wired, to stay consistent.

- [ ] **Step 6: Run admin tests — expect PASS** (client test passes; existing tests still green since the bundle gained a field with a memory default).

Run: `pnpm --filter @setu/admin test`
Expected: PASS. (If `servicesFor`/`createServices` call sites in tests break, they don't pass `opts` — the memory default covers them.)

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/media/media-client.ts apps/admin/src/data/media-index-store.tsx apps/admin/src/data/store.tsx apps/admin/src/data/Bootstrap.tsx apps/admin/test/media-client.test.ts
git commit -m "feat(admin): media client + useMediaIndex wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `MediaGrid` shared component (manage + pick)

**Files:**
- Create: `apps/admin/src/media/MediaGrid.tsx`
- Test: `apps/admin/test/media-grid.test.tsx`

**Reference:** mirror the query/effect pattern in `apps/admin/src/screens/ContentList.tsx` (debounced search, `useEffect` query with `offset/limit`, pagination). Resolve image URLs with `resolveMediaSrc(`/media/${row.thumbKey ?? row.key}`, apiBase)` from `../editor/media-src`.

**Interfaces:**
- Consumes: `useMediaIndex`, `MediaIndexRow`, `resolveMediaSrc`.
- Produces: `<MediaGrid mode onPick? apiBase query onQueryChange? />`. `mode: 'manage' | 'pick'`. In `pick` mode, clicking a tile calls `onPick({ src: '/media/' + row.key, row })`. The grid renders tiles (thumbnail via `thumbKey` for images, a file-icon for `isImage:false`), filename, dims, size. It owns its data fetch (calls `useMediaIndex().ensureBuilt()` then `query`) and re-queries when `query` props change; it also calls `refresh()` once on mount (stale-while-revalidate) and re-queries after.

- [ ] **Step 1: Write the failing test** — seed a memory media index, render in pick mode, assert tiles + onPick payload.

```tsx
// apps/admin/test/media-grid.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { MediaGrid } from '../src/media/MediaGrid'
import type { MediaRecord } from '@setu/core'

const rec = (mediaKey: string, filename: string): MediaRecord => ({
  mediaKey, key: `${mediaKey}.png`, thumbKey: `${mediaKey}-400w.webp`, filename,
  contentType: 'image/png', isImage: true, width: 800, height: 600, bytes: 1234, uploadedAt: 1,
})

async function svcWith(recs: MediaRecord[]) {
  const svc = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => recs })
  await svc.ensureBuilt()
  return svc
}

describe('MediaGrid', () => {
  it('renders a tile per item and calls onPick with the original src', async () => {
    const svc = await svcWith([rec('2026/06/cat', 'cat.png')])
    const onPick = vi.fn()
    render(
      <MediaIndexProvider service={svc}>
        <MediaGrid mode="pick" apiBase="http://x" onPick={onPick} query={{ offset: 0, limit: 24 }} />
      </MediaIndexProvider>,
    )
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ src: '/media/2026/06/cat.png' }))
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @setu/admin exec vitest run test/media-grid.test.tsx`

- [ ] **Step 3: Implement `MediaGrid`** — see Reference. Each tile is a `<button>` (pick mode) / selectable card (manage mode) labelled by filename so the test's `getByRole('button', { name: /cat\.png/i })` resolves. Use `loading="lazy"` on tile `<img>`. Empty result → "No matches"; loading → a skeleton/`aria-busy`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/media/MediaGrid.tsx apps/admin/test/media-grid.test.tsx
git commit -m "feat(admin): shared MediaGrid (manage/pick)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `/media` library screen

**Files:**
- Modify: `apps/admin/src/screens/Media.tsx`
- Test: `apps/admin/test/media-screen.test.tsx`

**Reference:** `ContentList.tsx` for the toolbar + URL-search-param state (`useSearchParams`, debounced search, sort/type selects). `PageHeader` from `../shell/PageHeader`.

**Interfaces:**
- Consumes: `useMediaIndex`, `useServices().index` (content index, for `referencedBy`), `MediaGrid`, `MediaDropzone`, `deleteMedia`, `resolveMediaSrc`.

**Behaviour:**
- Toolbar: type-ahead search (`q`), sort (Newest=uploadedAt desc / Name=filename asc / Largest=bytes desc), type filter (All / Images) — all in URL params.
- `MediaDropzone` (full-width drop zone) → on `onUploaded(result)` call `mediaIndex.upsertOne(result.record)` and re-query (new tile appears at top).
- `MediaGrid mode="manage"`; selecting a tile opens a detail panel with: filename/dims/size, **Copy URL** (`resolveMediaSrc('/media/' + row.key, apiBase)`), and **Delete**.
- Delete flow: `const used = await index.referencedBy(row.mediaKey)`; if `used.length > 0` show a confirm listing the titles ("Used in N posts: …. Delete anyway?"); on confirm `await deleteMedia(apiBase, row.mediaKey)` then `await mediaIndex.removeOne(row.mediaKey)` and re-query. Surface errors inline (`role="alert"`).
- Empty state: "No media yet — drag a file here".

- [ ] **Step 1: Write the failing test** — render `Media` inside `ActorProvider` + `ServicesProvider` (seed the content `index` with a row whose `mediaRefs` includes the item) + `MediaIndexProvider` (seed one media record); assert the grid shows the item; click Delete → because it's referenced, a confirm appears naming the post; confirm → `deleteMedia` called. Mock `deleteMedia` via `vi.mock('../src/media/media-client', …)`.

```tsx
// apps/admin/test/media-screen.test.tsx — skeleton; implementer completes the providers
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
// mock the client so no real fetch happens
vi.mock('../src/media/media-client', async (orig) => ({ ...(await orig() as object), deleteMedia: vi.fn(async () => {}) }))
// ...build services with a seeded content index row { mediaRefs: ['2026/06/cat'], title: 'My Post' }
// ...build a media index service seeded with rec('2026/06/cat','cat.png')
// render <Media/>; await tile 'cat.png'; open it; click Delete;
// expect a confirm mentioning 'My Post'; confirm; expect deleteMedia called with '2026/06/cat'.
```
> Implementer: complete the provider wiring using the patterns from `appearance.test.tsx` (ActorProvider + ServicesProvider + createServices/servicesFor) plus `MediaIndexProvider`. Seed the content index via `services.index.upsert(...)` or by building it from a seeded draft; pass a custom memory `MediaIndexPort` through `servicesFor(..., { mediaIndex })` then `ensureBuilt`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the screen** per Behaviour, mirroring `ContentList` for the toolbar/URL-state and using `MediaGrid` + `MediaDropzone`.

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @setu/admin exec vitest run test/media-screen.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens/Media.tsx apps/admin/test/media-screen.test.tsx
git commit -m "feat(admin): /media library screen (grid, search, upload, delete-with-where-used)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Editor pick-or-upload modal

**Files:**
- Create: `apps/admin/src/editor/MediaPickerModal.tsx`
- Modify: `apps/admin/src/editor/image-insert.ts` (add `imageBlockFromSrc`)
- Modify: `apps/admin/src/editor/blocks.ts` (slash `/image` opens the modal)
- Test: `apps/admin/test/media-picker-modal.test.tsx`

**Interfaces:**
- Produces: `imageBlockFromSrc(src: string): ImageBlockSpec`; `<MediaPickerModal apiBase open onClose onPick />` with a **Library** tab (`MediaGrid mode="pick"`) and an **Upload** tab (`MediaDropzone`). Both paths produce a `/media/...` src handed to `onPick(src)`.

- [ ] **Step 1: Add `imageBlockFromSrc`** to `apps/admin/src/editor/image-insert.ts` and refactor `imageNodeFromUpload` to use it:
```ts
export function imageBlockFromSrc(src: string): ImageBlockSpec {
  return { type: 'imageBlock', attrs: { mdAttrs: { src, align: 'none' } } }
}
export function imageNodeFromUpload(result: UploadResult): ImageBlockSpec {
  if (!result.contentType.startsWith('image/')) throw new Error(`not an image: ${result.contentType}`)
  return imageBlockFromSrc(srcFromUploadUrl(result.url))
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// apps/admin/test/media-picker-modal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMediaIndexService } from '@setu/core'
import { createMemoryMediaIndexPort } from '@setu/db-memory'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { MediaPickerModal } from '../src/editor/MediaPickerModal'
import type { MediaRecord } from '@setu/core'

const rec: MediaRecord = { mediaKey: '2026/06/cat', key: '2026/06/cat.png', thumbKey: '2026/06/cat-400w.webp', filename: 'cat.png', contentType: 'image/png', isImage: true, width: 8, height: 6, bytes: 1, uploadedAt: 1 }

describe('MediaPickerModal', () => {
  it('picks an existing library image and returns its /media src', async () => {
    const svc = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => [rec] })
    await svc.ensureBuilt()
    const onPick = vi.fn()
    render(<MediaIndexProvider service={svc}><MediaPickerModal apiBase="http://x" open onClose={() => {}} onPick={onPick} /></MediaIndexProvider>)
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(onPick).toHaveBeenCalledWith('/media/2026/06/cat.png')
  })
})
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `MediaPickerModal`** — a simple modal (reuse any existing modal/dialog primitive in `apps/admin/src/shell`; if none, a `role="dialog"` div with an overlay). Tabs: Library (`MediaGrid mode="pick" onPick={({ src }) => onPick(src)}`) and Upload (`MediaDropzone onUploaded={(r) => onPick(srcFromUploadUrl(r.url))}`). Close on pick.

- [ ] **Step 5: Wire the slash command** — in `apps/admin/src/editor/blocks.ts`, change the `/image` `run` so that instead of `pickImageAndInsert(...)` it opens the modal and, on pick, inserts via `editor.chain().focus().insertContent(imageBlockFromSrc(src)).run()`. The modal is rendered at the editor root (e.g. `Canvas.tsx`) driven by editor storage state (`editor.storage.imageBlock` already exists for handlers). Concretely: add an open-flag + pending callback to the editor's image storage, have `/image` set it, and render `<MediaPickerModal>` in `Canvas.tsx` bound to that storage. Keep `pickImageAndInsert` available as the Upload-tab path.
> Implementer: read `apps/admin/src/editor/Canvas.tsx` to see how `editor.storage.imageBlock` is initialized; thread `apiBase` (already set there) into the modal. Keep the change minimal and consistent with how the slash menu + storage already interact.

- [ ] **Step 6: Run — expect PASS** (modal test + existing editor tests).

Run: `pnpm --filter @setu/admin test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/MediaPickerModal.tsx apps/admin/src/editor/image-insert.ts apps/admin/src/editor/blocks.ts apps/admin/src/editor/Canvas.tsx apps/admin/test/media-picker-modal.test.tsx
git commit -m "feat(admin): editor pick-or-upload media modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] Full suite: `pnpm -r test` → all green.
- [ ] Typecheck: `pnpm -r exec tsc --noEmit` (or the repo's typecheck script) → clean.
- [ ] Manual smoke (one dev stack): upload via `/media`, see it in the grid; insert in a post via slash `/image` → Library tab → pick; delete a used image → where-used warning lists the post.

## Roadmap (deferred = sequenced next, not shelved)

1. **Bulk delete** — multi-select + per-item where-used roll-up.
2. **6B rename / move** — reuses `referencedBy`.
3. **Rich media records** — default alt/title/tags + tag filter.
4. **Edge `MediaIndexPort` adapter** (KV/D1).
5. **Gallery block** — reuses `MediaDropzone` + `MediaGrid`.
