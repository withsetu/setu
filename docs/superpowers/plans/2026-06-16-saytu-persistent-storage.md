# Persistent In-Browser Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the admin's drafts + Git working set in IndexedDB so a page reload restores work instead of wiping it.

**Architecture:** Two new adapter packages — `@setu/db-idb` (DataPort) and `@setu/git-idb` (GitPort) — backed by IndexedDB via the tiny `idb` wrapper, each passing the existing port contract suites. A shared, adapter-agnostic `bootstrapServices(data, git)` assembles the services and seeds samples only when empty; `main.tsx` wires the idb adapters in (with a loading state + in-memory fallback). A dev-only "Reset to sample content" is gated behind `import.meta.env.DEV`. **No `@setu/core` engine changes.**

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), `idb` 8.x (ISC), `fake-indexeddb` 6.x (Apache-2.0, dev/test), Vitest, React 18, Vite.

**Spec:** `docs/superpowers/specs/2026-06-16-saytu-persistent-storage-design.md`

**Verified (per the rule):** idb v8 — `openDB(name, version, { upgrade(db) {...} })`; in `upgrade`, `db.createObjectStore(name)` (out-of-line keys); async `db.get(store,key)` / `db.getAll(store)` / `db.getAllKeys(store)` / `db.put(store,value,key)` / `db.delete(store,key)` / `db.close()`; `deleteDB(name)` exported from `idb`. `fake-indexeddb/auto` import polyfills global `indexedDB` (works in Node, no jsdom needed). `runDataPortContract` calls `makeAdapter()` fresh in `beforeEach` and `db.close()` in `afterEach` (so the idb `makeAdapter` must use a unique db name per call). `GitPort` has **no** `close()` (don't add one); `DataPort` has `close()`.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/db-idb/{package.json,tsconfig.json,vitest.config.ts}` | new package scaffolding | 1 |
| `packages/db-idb/src/{index.ts,adapter.ts}` | `createIdbDataPort(dbName?)` | 1 |
| `packages/db-idb/test/contract.test.ts` | contract + persistence round-trip | 1 |
| `packages/git-idb/{package.json,tsconfig.json,vitest.config.ts}` | new package scaffolding | 2 |
| `packages/git-idb/src/{index.ts,adapter.ts}` | `createIdbGitPort(dbName?)` | 2 |
| `packages/git-idb/test/contract.test.ts` | contract + round-trip + seed-listable | 2 |
| `apps/saytu-admin/src/data/store.tsx` | + `bootstrapServices` / `seedIfEmpty` | 3 |
| `apps/saytu-admin/test/bootstrap.test.tsx` | seed-on-empty logic (in-memory adapters) | 3 |
| `apps/saytu-admin/src/data/Bootstrap.tsx` | async-open idb + loading + fallback provider | 4 |
| `apps/saytu-admin/src/data/reset.ts` | dev-only `resetToSampleContent()` | 4 |
| `apps/saytu-admin/src/main.tsx` | wire `<Bootstrap>` + dev reset | 4 |
| `apps/saytu-admin/package.json` | + `@setu/db-idb`, `@setu/git-idb` | 4 |

> **Reference shapes:** mirror `packages/db-memory/` for package.json/tsconfig/vitest.config and the adapter's value-semantics (createdAt/updatedAt upsert), and `packages/git-memory/src/adapter.ts` for the deterministic `sha40`. Read them before writing.

---

## Task 1: `@setu/db-idb` — IndexedDB DataPort

**Files:** create `packages/db-idb/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/adapter.ts`, `src/index.ts`, `test/contract.test.ts`.

- [ ] **Step 1: Scaffold the package**

`packages/db-idb/package.json`:

```json
{
  "name": "@setu/db-idb",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*", "idb": "^8.0.3" },
  "devDependencies": {
    "@setu/db-testing": "workspace:*",
    "fake-indexeddb": "^6.2.5",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`packages/db-idb/tsconfig.json` (copy from `packages/db-memory/tsconfig.json` verbatim — same extends/compilerOptions).

`packages/db-idb/vitest.config.ts` (copy from `packages/db-memory/vitest.config.ts` if present; otherwise):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { environment: 'node' } })
```

Then from the repo root: `pnpm install` (links the workspace package + installs idb/fake-indexeddb).
Expected: resolves; `idb` + `fake-indexeddb` present.

- [ ] **Step 2: Write the failing contract + round-trip test**

`packages/db-idb/test/contract.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { runDataPortContract } from '@setu/db-testing'
import { createIdbDataPort } from '../src/index'

let n = 0
const freshName = () => `db-idb-test-${(n += 1)}`

runDataPortContract(() => createIdbDataPort(freshName()))

describe('createIdbDataPort persistence', () => {
  it('restores a draft after closing and reopening the same database', async () => {
    const name = freshName()
    const a = await createIdbDataPort(name)
    await a.saveDraft({
      collection: 'post',
      locale: 'en',
      slug: 'persisted',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }] },
      metadata: { title: 'Persisted' },
    })
    await a.close()

    const b = await createIdbDataPort(name)
    const got = await b.getDraft({ collection: 'post', locale: 'en', slug: 'persisted' })
    expect(got?.metadata.title).toBe('Persisted')
    await b.close()
  })
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @setu/db-idb test`
Expected: FAIL — `createIdbDataPort` not exported.

- [ ] **Step 4: Implement the adapter**

`packages/db-idb/src/adapter.ts`:

```ts
import { openDB } from 'idb'
import type { DataPort, Draft, DraftInput, EntryRef, Lock } from '@setu/core'

// NUL composite key — cannot appear in collection/locale/slug, so refs never collide.
const keyOf = (r: EntryRef): string => `${r.collection}\0${r.locale}\0${r.slug}`

/** An IndexedDB-backed DataPort (drafts + locks), behaviorally equivalent to
 *  db-memory (proven by runDataPortContract) but persistent across reloads.
 *  `dbName` is parameterized so tests get a fresh database per run. */
export async function createIdbDataPort(dbName = 'saytu-data'): Promise<DataPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('drafts')
      d.createObjectStore('locks')
    },
  })

  return {
    async getDraft(ref) {
      const d = (await db.get('drafts', keyOf(ref))) as Draft | undefined
      return d ?? null
    },
    async saveDraft(input: DraftInput) {
      const k = keyOf(input)
      const existing = (await db.get('drafts', k)) as Draft | undefined
      const now = Date.now()
      const stored: Draft = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
        content: input.content,
        metadata: input.metadata,
        baseSha: input.baseSha ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await db.put('drafts', stored, k)
      return structuredClone(stored)
    },
    async deleteDraft(ref) {
      await db.delete('drafts', keyOf(ref))
    },
    async listDrafts(filter) {
      const all = (await db.getAll('drafts')) as Draft[]
      return filter?.collection ? all.filter((d) => d.collection === filter.collection) : all
    },
    async getLock(ref) {
      const l = (await db.get('locks', keyOf(ref))) as Lock | undefined
      return l ?? null
    },
    async putLock(lock) {
      await db.put('locks', { ...lock }, keyOf(lock))
    },
    async deleteLock(ref) {
      await db.delete('locks', keyOf(ref))
    },
    async close() {
      db.close()
    },
  }
}
```

`packages/db-idb/src/index.ts`:

```ts
export { createIdbDataPort } from './adapter'
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @setu/db-idb test`
Expected: PASS (all `runDataPortContract` cases + the persistence round-trip).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @setu/db-idb typecheck`
Expected: PASS (`idb` returns `any` from `get`/`getAll`, so the `as Draft`/`as Lock` casts are required under `noUncheckedIndexedAccess`).

- [ ] **Step 7: Commit**

```bash
git add packages/db-idb pnpm-lock.yaml
git commit -m "feat(db-idb): IndexedDB-backed DataPort (persistent, passes the contract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `@setu/git-idb` — IndexedDB GitPort

**Files:** create `packages/git-idb/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/adapter.ts`, `src/index.ts`, `test/contract.test.ts`.

- [ ] **Step 1: Scaffold the package**

`packages/git-idb/package.json` (same shape as db-idb but git-testing):

```json
{
  "name": "@setu/git-idb",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*", "idb": "^8.0.3" },
  "devDependencies": {
    "@setu/git-testing": "workspace:*",
    "fake-indexeddb": "^6.2.5",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.json` + `vitest.config.ts`: copy from db-idb (Step 1 above). Then `pnpm install` from the root.

- [ ] **Step 2: Write the failing contract + round-trip test**

`packages/git-idb/test/contract.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { runGitPortContract } from '@setu/git-testing'
import { createIdbGitPort } from '../src/index'

const author = { name: 'Test', email: 'test@x.com' }
let n = 0
const freshName = () => `git-idb-test-${(n += 1)}`

runGitPortContract(() => createIdbGitPort(freshName()))

describe('createIdbGitPort persistence', () => {
  it('restores committed content after reopening the same database', async () => {
    const name = freshName()
    const a = await createIdbGitPort(name)
    await a.commitFile({ path: 'content/post/en/a.mdoc', content: 'A', message: 'm', author })
    const headA = await a.headSha()

    const b = await createIdbGitPort(name)
    expect(await b.readFile('content/post/en/a.mdoc')).toBe('A')
    expect(await b.list('content/')).toEqual(['content/post/en/a.mdoc'])
    expect(await b.headSha()).toBe(headA)
  })
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @setu/git-idb test`
Expected: FAIL — `createIdbGitPort` not exported.

- [ ] **Step 4: Implement the adapter**

`packages/git-idb/src/adapter.ts`:

```ts
import { openDB } from 'idb'
import type { CommitInput, CommitResult, GitPort } from '@setu/core'

// Deterministic 40-char hex digest (no Date.now/Math.random): 5 salted FNV-1a
// passes. Distinct per commit because the persisted counter is mixed in.
// (Same scheme as git-memory.)
function sha40(input: string): string {
  let out = ''
  for (let salt = 0; salt < 5; salt += 1) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

/** An IndexedDB-backed GitPort (a `files` store path->content + a `meta` store
 *  holding the head sha and a commit counter). Behaviorally equivalent to
 *  git-memory (proven by runGitPortContract) but persistent across reloads. */
export async function createIdbGitPort(dbName = 'saytu-git'): Promise<GitPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('files')
      d.createObjectStore('meta')
    },
  })

  return {
    async headSha() {
      return ((await db.get('meta', 'head')) as string | undefined) ?? null
    },
    async readFile(path: string) {
      return ((await db.get('files', path)) as string | undefined) ?? null
    },
    async commitFile(input: CommitInput): Promise<CommitResult> {
      const counter = (((await db.get('meta', 'counter')) as number | undefined) ?? 0) + 1
      const prevHead = ((await db.get('meta', 'head')) as string | undefined) ?? ''
      const sha = sha40(`${counter}\0${prevHead}\0${input.path}\0${input.content}`)
      await db.put('files', input.content, input.path)
      await db.put('meta', counter, 'counter')
      await db.put('meta', sha, 'head')
      return { sha }
    },
    async list(prefix?: string) {
      const keys = (await db.getAllKeys('files')) as string[]
      return prefix === undefined ? keys : keys.filter((k) => k.startsWith(prefix))
    },
  }
}
```

`packages/git-idb/src/index.ts`:

```ts
export { createIdbGitPort } from './adapter'
```

> Note: `GitPort` has no `close()` — do not add one (matches the interface + git-memory/git-local).

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @setu/git-idb test`
Expected: PASS (`runGitPortContract` + persistence round-trip).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @setu/git-idb typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/git-idb pnpm-lock.yaml
git commit -m "feat(git-idb): IndexedDB-backed GitPort (persistent, passes the contract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `bootstrapServices` + seed-on-empty (adapter-agnostic, tested)

**Files:** modify `apps/saytu-admin/src/data/store.tsx`; create `apps/saytu-admin/test/bootstrap.test.tsx`.

- [ ] **Step 1: Write the failing test (in-memory adapters — same shipped logic)**

`apps/saytu-admin/test/bootstrap.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { bootstrapServices, seedDrafts } from '../src/data/store'

describe('bootstrapServices seed-on-empty', () => {
  it('seeds the sample drafts when the store is empty', async () => {
    const services = await bootstrapServices(createMemoryDataPort(), createMemoryGitPort())
    const drafts = await services.data.listDrafts()
    expect(drafts).toHaveLength(seedDrafts.length)
    expect(drafts.map((d) => d.slug).sort()).toEqual(seedDrafts.map((d) => d.slug).sort())
  })

  it('does NOT re-seed when the store already has content', async () => {
    const data = createMemoryDataPort([
      { collection: 'post', locale: 'en', slug: 'mine', content: { type: 'doc', content: [] }, metadata: { title: 'Mine' } },
    ])
    const services = await bootstrapServices(data, createMemoryGitPort())
    const drafts = await services.data.listDrafts()
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.slug).toBe('mine')
  })

  it('does NOT re-seed when Git has commits but DB is empty', async () => {
    const git = createMemoryGitPort([{ path: 'content/post/en/x.mdoc', content: '# x' }])
    const services = await bootstrapServices(createMemoryDataPort(), git)
    expect(await services.data.listDrafts()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- bootstrap`
Expected: FAIL — `bootstrapServices` not exported.

- [ ] **Step 3: Implement `bootstrapServices` + `seedIfEmpty`**

In `apps/saytu-admin/src/data/store.tsx`, add (after `servicesFor`):

```tsx
/** Seed the sample drafts only when the store is completely empty (no drafts AND
 *  no Git head) — so a reload never re-seeds over real content. */
async function seedIfEmpty(services: Services): Promise<void> {
  const [drafts, head] = await Promise.all([services.data.listDrafts(), services.git.headSha()])
  if (drafts.length === 0 && head === null) {
    for (const s of seedDrafts) await services.data.saveDraft(s)
  }
}

/** Assemble the services bundle around any DataPort/GitPort and seed-if-empty.
 *  Adapter-agnostic: the app passes the persistent (idb) adapters, tests pass the
 *  in-memory ones — the same shipped bootstrap logic either way. */
export async function bootstrapServices(data: DataPort, git: GitPort): Promise<Services> {
  const services = servicesFor(data, git)
  await seedIfEmpty(services)
  return services
}
```

(`seedDrafts` is already exported from this file; keep it exported.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- bootstrap`
Expected: PASS (3 cases).

- [ ] **Step 5: Typecheck + full admin suite**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test`
Expected: PASS (existing suite unaffected — `createServices`/`servicesFor` unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/saytu-admin/src/data/store.tsx apps/saytu-admin/test/bootstrap.test.tsx
git commit -m "feat(admin): adapter-agnostic bootstrapServices + seed-only-when-empty

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire idb into `main.tsx` (loading + fallback) + dev reset

**Files:** modify `apps/saytu-admin/package.json`; create `apps/saytu-admin/src/data/Bootstrap.tsx`, `apps/saytu-admin/src/data/reset.ts`; modify `apps/saytu-admin/src/main.tsx`.

- [ ] **Step 1: Add the idb adapter packages to the app**

In `apps/saytu-admin/package.json` `dependencies`, add (all three — `idb` is imported directly by `reset.ts` for `deleteDB`, so it must be a declared dep under pnpm-strict):

```json
    "@setu/db-idb": "workspace:*",
    "@setu/git-idb": "workspace:*",
    "idb": "^8.0.3",
```

Then `pnpm install` from the root.

- [ ] **Step 2: Create the async bootstrap provider**

`apps/saytu-admin/src/data/Bootstrap.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIdbDataPort } from '@setu/db-idb'
import { createIdbGitPort } from '@setu/git-idb'
import { bootstrapServices, ServicesProvider, type Services } from './store'

/** Opens the persistent (IndexedDB) adapters, seeds-if-empty, and provides the
 *  services once ready. Falls back to in-memory storage (non-persistent, but the
 *  app still works) if IndexedDB can't be opened. */
export function Bootstrap({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Services | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      let ready: Services
      try {
        const data = await createIdbDataPort()
        const git = await createIdbGitPort()
        ready = await bootstrapServices(data, git)
      } catch (err) {
        console.error('IndexedDB unavailable — using in-memory storage for this session.', err)
        ready = await bootstrapServices(createMemoryDataPort(), createMemoryGitPort())
      }
      if (live) setServices(ready)
    })()
    return () => {
      live = false
    }
  }, [])

  if (services === null) {
    return (
      <div className="boot-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }
  return <ServicesProvider services={services}>{children}</ServicesProvider>
}
```

> If `Services` isn't already exported from `store.tsx`, add `export` to its `interface Services`. (It's currently exported — confirm and keep.)

- [ ] **Step 3: Create the dev-only reset**

`apps/saytu-admin/src/data/reset.ts`:

```ts
import { deleteDB } from 'idb'

/** DEV-ONLY: wipe the persistent stores and reload (the bootstrap re-seeds the
 *  samples because the DB is then empty). Never shipped — callers gate on
 *  import.meta.env.DEV so Vite eliminates it from production. */
export async function resetToSampleContent(): Promise<void> {
  await Promise.all([deleteDB('saytu-data'), deleteDB('saytu-git')])
  location.reload()
}
```

> `idb` (used here for `deleteDB`) is declared as a direct app dependency in Step 1 — required under pnpm-strict to import from `'idb'`.

- [ ] **Step 4: Wire `main.tsx`**

Replace `apps/saytu-admin/src/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app'
import { Bootstrap } from './data/Bootstrap'
import { resetToSampleContent } from './data/reset'
import { ActorProvider } from './auth/actor'
import { DeployProvider } from './deploy/deploy'
import './index.css'

/** Dev-only escape hatch; compiled out of production by Vite. */
function DevReset() {
  if (!import.meta.env.DEV) return null
  return (
    <button
      type="button"
      className="dev-reset"
      onClick={() => {
        void resetToSampleContent()
      }}
    >
      Reset to sample content
    </button>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Bootstrap>
        <ActorProvider>
          <DeployProvider>
            <App />
          </DeployProvider>
        </ActorProvider>
        <DevReset />
      </Bootstrap>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 5: Add minimal CSS for the loading + dev reset**

Append to `apps/saytu-admin/src/styles/editor.css` (or `index.css` — pick the one already imported; editor.css is imported last):

```css
/* Bootstrap loading + dev-only reset */
.boot-loading { display: grid; place-items: center; height: 100%; color: var(--text-3); font-family: var(--font-ui); }
.dev-reset {
  position: fixed; bottom: 10px; left: 10px; z-index: 200;
  padding: 5px 9px; font-size: 11px; font-family: var(--font-ui);
  background: var(--surface); color: var(--text-3);
  border: 1px solid var(--border-strong); border-radius: var(--r-sm); cursor: pointer; opacity: 0.6;
}
.dev-reset:hover { opacity: 1; }
```

- [ ] **Step 6: Typecheck + full admin suite + build**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin test && pnpm --filter @setu/admin build`
Expected: PASS. Build succeeds; confirm the dev reset is eliminated: `grep -c "Reset to sample content" apps/saytu-admin/dist/assets/*.js` → `0` (Vite drops the `import.meta.env.DEV` branch).

- [ ] **Step 7: Manual smoke (reviewer)**

`pnpm dev`: create/edit content → **reload → it's still there**. First-ever run (or after reset) shows the samples. The "Reset to sample content" button (bottom-left, dev only) wipes + reseeds.

- [ ] **Step 8: Commit**

```bash
git add apps/saytu-admin/package.json apps/saytu-admin/src/data/Bootstrap.tsx apps/saytu-admin/src/data/reset.ts apps/saytu-admin/src/main.tsx apps/saytu-admin/src/styles/editor.css pnpm-lock.yaml
git commit -m "feat(admin): persist via IndexedDB on boot (loading + in-memory fallback) + dev reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification

- [ ] **Step 1: Whole suite** — Run: `pnpm -r test` — expect every package green, incl. new `@setu/db-idb` + `@setu/git-idb` (contract + round-trip) and the admin bootstrap test.
- [ ] **Step 2: Typecheck** — Run: `pnpm -r typecheck` — expect clean (incl. core edge guard).
- [ ] **Step 3: Build (dev reset absent + fonts + jiti-free)** — Run: `pnpm --filter @setu/admin build`; then `grep -c "Reset to sample content" apps/saytu-admin/dist/assets/*.js` → `0`; brand fonts still linked in `dist/index.html`.
- [ ] **Step 4: Manual** — `pnpm dev`, reload persists; idb + the in-memory fallback both work (the fallback is exercised by temporarily disabling IndexedDB in devtools, optional).

---

## Self-Review Notes (author)

- **Spec coverage:** db-idb → Task 1; git-idb → Task 2; adapter-agnostic `bootstrapServices` + seed-on-empty (tested with in-memory) → Task 3; async `main.tsx` wiring + loading + in-memory fallback + dev-gated reset → Task 4; suite/build/no-dev-reset-in-prod → Task 5. The "tested == shipped" decision is realized: Task 3 tests the *same* bootstrap the app runs (Task 4), only the adapter differs.
- **No engine changes:** only new packages + app wiring; `@setu/core` untouched. New deps: `idb` (ISC) in db-idb/git-idb/admin, `fake-indexeddb` (Apache-2.0) devDep in the two adapter packages.
- **Contract-fresh adapters:** idb `makeAdapter` uses a unique `dbName` per call so `runDataPortContract`/`runGitPortContract` (fresh per `beforeEach`) get empty stores; `fake-indexeddb/auto` polyfills global `indexedDB` in Node.
- **Type consistency:** `createIdbDataPort(dbName?) => Promise<DataPort>`, `createIdbGitPort(dbName?) => Promise<GitPort>` (no `close` — GitPort has none), `bootstrapServices(data, git) => Promise<Services>`, `resetToSampleContent() => Promise<void>` — used identically across tasks.
- **Honest test scope:** the idb adapters + the seed logic are fully tested; the `main.tsx`/`Bootstrap` glue + dev reset are verified by build + manual (consistent with prior glue-layer deferrals). The build grep proves the dev reset is compiled out.
- **DB-open is async** so `createIdb*` return Promises; the app handles it with the loading state. structuredClone (node 22) for value semantics on saveDraft return.
```
