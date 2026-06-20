# StoragePort Foundation (Media Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dumb keyed-blob `StoragePort` (in `@setu/core`, edge-safe) + a contract battery (`@setu/storage-testing`) + the first real adapter (`@setu/storage-local`, disk, path-traversal-hardened), mirroring the `DataPort` increment.

**Architecture:** The `StoragePort` interface is pure edge-safe types in `@setu/core` (covered by the edge guard). `@setu/storage-testing` exports `runStoragePortContract(makeAdapter)` — a Vitest battery every adapter runs, self-tested against an inline in-memory reference. `@setu/storage-local` implements it over `node:fs` with a content-type sidecar and key sanitisation.

**Tech Stack:** TypeScript, `node:fs/promises`, Vitest. No runtime deps beyond `@setu/core`.

## Global Constraints

- **Rule #2 — Cloudflare/edge-safe:** the `StoragePort` interface + types live in `@setu/core` and MUST stay edge/browser-safe (no Node APIs) — enforced by `packages/core/tsconfig.edge.json`. Node-only adapter code (`node:fs`) lives in `@setu/storage-local`, never in core (mirrors how `db-sqlite` keeps `better-sqlite3` out of core).
- **Dumb bytes:** the port stores/serves keyed blobs only — no image/variant/optimization knowledge. `body` is `Uint8Array`; `key` is opaque.
- **No presigning / `signUrl` / `close` / S3 in this slice** — deferred to later media sub-projects (roadmap).
- **Security:** `storage-local` MUST reject path-traversal keys (`..`, absolute, escaping `dir`) before any fs access.
- **Pattern parity:** copy the structure of `@setu/db-testing` (contract suite, `vitest` peerDep) and `@setu/db-memory`/`@setu/db-sqlite` (adapter + a contract test that runs the battery). Reuse their `tsconfig.json` + `vitest.config.ts` verbatim.
- **Versions:** TypeScript ^5.6.3, Vitest ^2.1.8, `@types/node` ^22.10.2 — match the rest of the repo; do not bump.
- **Branch:** `feat/storage-port` (already checked out).
- After creating each new workspace package, run `pnpm install` from the repo root so its symlinks resolve.

---

### Task 1: `StoragePort` interface in `@setu/core` (edge-safe)

**Files:**
- Create: `packages/core/src/storage/storage-port.ts`
- Modify: `packages/core/src/index.ts` (export the types)
- Modify: `packages/core/tsconfig.edge.json` (include `src/storage` in the edge guard)

**Interfaces:**
- Produces: `StoragePort` (`put`/`get`/`delete`/`exists`/`url`), `PutOptions` (`{ contentType: string }`), `StoredObject` (`{ body: Uint8Array; contentType: string }`) — exported from `@setu/core`.

- [ ] **Step 1: Write the interface**

```ts
// packages/core/src/storage/storage-port.ts

/** Options for storing an object. */
export interface PutOptions {
  /** MIME type, persisted with the object and returned by `get`. */
  contentType: string
}

/** A stored binary object: its bytes and content type. */
export interface StoredObject {
  body: Uint8Array
  contentType: string
}

/** A dumb keyed-blob store for binary assets (media originals + variants). Knows
 *  nothing about images/variants/optimization — variants are just more keys the
 *  ImagePort manages. Adapters: storage-local (disk), storage-s3 (later). Pure types,
 *  edge/browser-safe (no Node APIs). */
export interface StoragePort {
  /** Store `body` under `key`, overwriting any existing object. */
  put(key: string, body: Uint8Array, opts: PutOptions): Promise<void>
  /** Read the object at `key`, or null when absent. */
  get(key: string): Promise<StoredObject | null>
  /** Remove the object at `key`. No error when already absent. */
  delete(key: string): Promise<void>
  /** Whether an object exists at `key`. */
  exists(key: string): Promise<boolean>
  /** Public URL at which `key` is served (pure construction). Private/signed URLs are
   *  a later, separate concern. */
  url(key: string): string
}
```

- [ ] **Step 2: Export from the barrel**

In `packages/core/src/index.ts`, after the `DataPort` exports (line ~22), add:

```ts
export type { StoragePort, PutOptions, StoredObject } from './storage/storage-port'
```

- [ ] **Step 3: Add `src/storage` to the edge guard**

In `packages/core/tsconfig.edge.json`, add `"src/storage"` to the `include` array:

```json
  "include": ["src/markdoc", "src/data", "src/storage", "src/authoring", "src/git", "src/publish", "src/read", "src/authz", "src/lifecycle", "src/content-index", "src/url"]
```

- [ ] **Step 4: Typecheck (both configs — proves edge-safety)**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS — `tsc --noEmit` AND `tsc -p tsconfig.edge.json --noEmit` (which uses `types: []`) both compile; the pure-types port has no Node/DOM dependency.

- [ ] **Step 5: Adversarial edge-guard check (then revert)**

Temporarily add `import { readFile } from 'node:fs/promises'` to the top of `storage-port.ts`, run `pnpm --filter @setu/core typecheck`, and confirm the **edge** config now FAILS (`Cannot find module 'node:fs/promises'` under `types: []`) — proving `src/storage` is genuinely covered by the guard. Then remove the import and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/storage-port.ts packages/core/src/index.ts packages/core/tsconfig.edge.json
git commit -m "feat(core): add the edge-safe StoragePort interface"
```

---

### Task 2: `@setu/storage-testing` — the contract battery + in-memory reference

**Files:**
- Create: `packages/storage-testing/package.json`
- Create: `packages/storage-testing/tsconfig.json` (copy `packages/db-testing/tsconfig.json` verbatim)
- Create: `packages/storage-testing/vitest.config.ts` (copy `packages/db-testing/vitest.config.ts` verbatim)
- Create: `packages/storage-testing/src/index.ts`
- Create: `packages/storage-testing/test/memory-adapter.test.ts`

**Interfaces:**
- Consumes: `StoragePort`, `StoredObject` (`@setu/core`, Task 1).
- Produces: `runStoragePortContract(makeAdapter: () => Promise<StoragePort> | StoragePort): void` — exported from `@setu/storage-testing`.

- [ ] **Step 1: Create the package manifest + configs**

```json
// packages/storage-testing/package.json
{
  "name": "@setu/storage-testing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "peerDependencies": { "vitest": "^2.0.0" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

Copy `packages/db-testing/tsconfig.json` → `packages/storage-testing/tsconfig.json` and `packages/db-testing/vitest.config.ts` → `packages/storage-testing/vitest.config.ts` verbatim.

- [ ] **Step 2: Write the contract battery**

```ts
// packages/storage-testing/src/index.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { StoragePort } from '@setu/core'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)
const text = (b: Uint8Array): string => new TextDecoder().decode(b)

/** Run the StoragePort behavioural contract against an adapter. `makeAdapter` must
 *  return a FRESH, empty store on each call. */
export function runStoragePortContract(makeAdapter: () => Promise<StoragePort> | StoragePort): void {
  describe('StoragePort contract', () => {
    let s: StoragePort
    beforeEach(async () => {
      s = await makeAdapter()
    })

    it('returns null for an absent key', async () => {
      expect(await s.get('missing/x.bin')).toBeNull()
    })

    it('round-trips exact bytes and contentType through put/get', async () => {
      await s.put('a/b.txt', bytes('hello'), { contentType: 'text/plain' })
      const got = await s.get('a/b.txt')
      expect(got).not.toBeNull()
      expect(Array.from(got!.body)).toEqual(Array.from(bytes('hello')))
      expect(text(got!.body)).toBe('hello')
      expect(got!.contentType).toBe('text/plain')
    })

    it('put overwrites an existing key', async () => {
      await s.put('k', bytes('one'), { contentType: 'text/plain' })
      await s.put('k', bytes('two'), { contentType: 'text/markdown' })
      const got = await s.get('k')
      expect(text(got!.body)).toBe('two')
      expect(got!.contentType).toBe('text/markdown')
    })

    it('exists reflects put + delete, and delete is idempotent', async () => {
      expect(await s.exists('k')).toBe(false)
      await s.put('k', bytes('x'), { contentType: 'application/octet-stream' })
      expect(await s.exists('k')).toBe(true)
      await s.delete('k')
      expect(await s.exists('k')).toBe(false)
      await s.delete('k') // no throw on absent
      expect(await s.get('k')).toBeNull()
    })

    it('url(key) contains the key', async () => {
      expect(s.url('media/abc/original.jpg')).toContain('media/abc/original.jpg')
    })
  })
}
```

- [ ] **Step 3: Self-test the battery against an inline in-memory reference**

```ts
// packages/storage-testing/test/memory-adapter.test.ts
import type { StoragePort, StoredObject } from '@setu/core'
import { runStoragePortContract } from '../src/index'

/** Minimal Map-backed StoragePort — the reference the contract self-tests against.
 *  Copies bytes in + out so callers can't mutate stored state (value semantics). */
function createMemoryStorage(baseUrl = '/uploads'): StoragePort {
  const store = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) {
      store.set(key, { body: new Uint8Array(body), contentType: opts.contentType })
    },
    async get(key) {
      const o = store.get(key)
      return o ? { body: new Uint8Array(o.body), contentType: o.contentType } : null
    },
    async delete(key) {
      store.delete(key)
    },
    async exists(key) {
      return store.has(key)
    },
    url(key) {
      return `${baseUrl}/${key}`
    },
  }
}

runStoragePortContract(() => createMemoryStorage())
```

- [ ] **Step 4: Link the workspace + run the suite**

Run: `pnpm install` (from repo root — links the new package), then `pnpm --filter @setu/storage-testing test`
Expected: PASS — the 5 contract tests run against the in-memory reference.

- [ ] **Step 5: Commit**

```bash
git add packages/storage-testing pnpm-lock.yaml
git commit -m "feat(storage-testing): StoragePort contract battery + in-memory reference"
```

---

### Task 3: `@setu/storage-local` — the disk adapter

**Files:**
- Create: `packages/storage-local/package.json`
- Create: `packages/storage-local/tsconfig.json` (copy `packages/db-memory/tsconfig.json` verbatim)
- Create: `packages/storage-local/vitest.config.ts` (copy `packages/db-memory/vitest.config.ts` verbatim)
- Create: `packages/storage-local/src/index.ts`
- Create: `packages/storage-local/test/contract.test.ts`
- Create: `packages/storage-local/test/local.test.ts`

**Interfaces:**
- Consumes: `StoragePort`, `StoredObject` (`@setu/core`); `runStoragePortContract` (`@setu/storage-testing`).
- Produces: `createLocalStorage(opts: LocalStorageOptions): StoragePort` where `LocalStorageOptions = { dir: string; baseUrl: string }`.

- [ ] **Step 1: Create the package manifest + configs**

```json
// packages/storage-local/package.json
{
  "name": "@setu/storage-local",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@setu/storage-testing": "workspace:*",
    "@types/node": "^22.10.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Copy `packages/db-memory/tsconfig.json` → `packages/storage-local/tsconfig.json` and `packages/db-memory/vitest.config.ts` → `packages/storage-local/vitest.config.ts` verbatim.

- [ ] **Step 2: Write the failing security + persistence tests**

```ts
// packages/storage-local/test/local.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '../src/index'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('storage-local — security + persistence', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('rejects path-traversal keys before touching disk', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
    const s = createLocalStorage({ dir, baseUrl: '/u' })
    await expect(s.put('../escape.txt', bytes('x'), { contentType: 'text/plain' })).rejects.toThrow()
    await expect(s.put('/etc/passwd', bytes('x'), { contentType: 'text/plain' })).rejects.toThrow()
    await expect(s.get('a/../../b')).rejects.toThrow()
  })

  it('persists bytes + contentType across adapter instances on the same dir', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
    const a = createLocalStorage({ dir, baseUrl: '/u' })
    await a.put('media/1/original.png', bytes('IMG'), { contentType: 'image/png' })
    const b = createLocalStorage({ dir, baseUrl: '/u' })
    const got = await b.get('media/1/original.png')
    expect(new TextDecoder().decode(got!.body)).toBe('IMG')
    expect(got!.contentType).toBe('image/png')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm install` (links the package), then `pnpm --filter @setu/storage-local test -- local`
Expected: FAIL — cannot find `../src/index`.

- [ ] **Step 4: Write the adapter**

```ts
// packages/storage-local/src/index.ts
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep, isAbsolute } from 'node:path'
import type { StoragePort, StoredObject } from '@setu/core'

export interface LocalStorageOptions {
  /** Directory under which objects are written. */
  dir: string
  /** Base URL objects are served from (trailing slash optional). */
  baseUrl: string
}

/** Reject keys that are absolute, contain `..` segments, or otherwise escape `dir`;
 *  return the safe absolute path under `dir`. */
function resolveKey(dir: string, key: string): string {
  if (isAbsolute(key) || key.split(/[\\/]/).includes('..')) {
    throw new Error(`storage-local: unsafe key "${key}"`)
  }
  const root = normalize(dir)
  const abs = normalize(join(root, key))
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`storage-local: key "${key}" escapes the storage dir`)
  }
  return abs
}

/** A disk-backed StoragePort. Writes `dir/<key>` plus a `<key>.ctype` sidecar holding
 *  the content type (so `get` returns it honestly, not by guessing the extension).
 *  Hardened against path traversal. */
export function createLocalStorage({ dir, baseUrl }: LocalStorageOptions): StoragePort {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    async put(key, body, opts) {
      const path = resolveKey(dir, key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
      await writeFile(`${path}.ctype`, opts.contentType, 'utf8')
    },
    async get(key): Promise<StoredObject | null> {
      const path = resolveKey(dir, key)
      try {
        const body = await readFile(path)
        let contentType = 'application/octet-stream'
        try {
          contentType = (await readFile(`${path}.ctype`, 'utf8')).trim() || contentType
        } catch {
          /* sidecar missing → default content type */
        }
        return { body: new Uint8Array(body), contentType }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async delete(key) {
      const path = resolveKey(dir, key)
      await rm(path, { force: true })
      await rm(`${path}.ctype`, { force: true })
    },
    async exists(key) {
      const path = resolveKey(dir, key)
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    },
    url(key) {
      return `${base}/${key.replace(/^\/+/, '')}`
    },
  }
}
```

- [ ] **Step 5: Add the contract test**

```ts
// packages/storage-local/test/contract.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { runStoragePortContract } from '@setu/storage-testing'
import { createLocalStorage } from '../src/index'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

runStoragePortContract(() => {
  const dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
  dirs.push(dir)
  return createLocalStorage({ dir, baseUrl: '/uploads' })
})
```

- [ ] **Step 6: Run the package tests + typecheck**

Run: `pnpm --filter @setu/storage-local test && pnpm --filter @setu/storage-local typecheck`
Expected: PASS — the security + persistence tests AND the full contract battery (run against fresh temp dirs) green.

- [ ] **Step 7: Commit**

```bash
git add packages/storage-local pnpm-lock.yaml
git commit -m "feat(storage-local): disk-backed StoragePort adapter (path-traversal hardened)"
```

---

### Task 4: Full-repo green + edge guard

**Files:** none (verification only).

- [ ] **Step 1: Run every suite + typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all green — the two new packages (`storage-testing`, `storage-local`) plus the whole existing repo (core incl. the edge guard over `src/storage`, admin, site, blocks, theme-default, api, db/git adapters). The new `packages/*` auto-joined the workspace.

- [ ] **Step 2: Final commit (only if anything needed fixing)**

```bash
git add -A && git commit -m "chore: StoragePort foundation (media slice 1) — full green"
```

---

## Self-Review

**Spec coverage:**
- `StoragePort` dumb keyed-blob interface in `@setu/core`, edge-safe → Task 1 (+ edge guard include + adversarial check). ✓
- `@setu/storage-testing` contract battery + in-memory reference, `vitest` peerDep → Task 2. ✓
- `@setu/storage-local` disk adapter with content-type sidecar → Task 3. ✓
- Path-traversal rejection (first-class security) → Task 3 (`resolveKey` + the security test). ✓
- `get`/`exists` absent → null/false; `delete` idempotent; fs errors propagate → Task 3 impl + the battery. ✓
- On-disk persistence across instances → Task 3 `local.test.ts`. ✓
- No presigning/signUrl/close/S3 (deferred) → not implemented; interface is minimal. ✓
- Full repo + edge guard green → Tasks 1, 4. ✓

**Placeholder scan:** none — complete code in every code step; `tsconfig.json`/`vitest.config.ts` are explicit "copy file X verbatim" instructions (db-testing/db-memory), not placeholders.

**Type consistency:** `StoragePort`/`PutOptions`/`StoredObject` (Task 1) are consumed identically in Tasks 2 & 3; `runStoragePortContract(makeAdapter)` (Task 2) is called the same way in Task 3's contract test; `createLocalStorage({ dir, baseUrl })` (Task 3) matches its `LocalStorageOptions`. `body: Uint8Array` is consistent across the interface, the reference, and the adapter (with `new Uint8Array(...)` copies for value semantics / Buffer→Uint8Array).
