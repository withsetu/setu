# DataPort + db-sqlite + Contract Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Saytu's first hexagonal Port & Adapter — the `DataPort` interface (in `@saytu/core`), a reusable contract test suite (`@saytu/db-testing`), and a `db-sqlite` adapter (Drizzle + better-sqlite3) that passes the contract — scoped to the drafts + locks authoring store.

**Architecture:** Pure async `DataPort` interface + domain types live in `@saytu/core/src/data` (Node-free types). `@saytu/db-testing` exports `runDataPortContract(makeAdapter)`, a Vitest battery any adapter runs; it is self-tested against an in-memory reference adapter. `@saytu/db-sqlite` implements the port with a Drizzle `sqlite-core` schema (composite PK `collection,locale,slug`), Drizzle-Kit migrations applied on init, and a test that runs the shared contract against an in-memory DB.

**Tech Stack:** TypeScript (strict), Drizzle ORM + Drizzle Kit, better-sqlite3, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-dataport-sqlite-design.md`

---

## File Structure

```
packages/core/src/data/
├── types.ts          # EntryRef, Draft, DraftInput, Lock
└── data-port.ts      # DataPort interface
packages/core/src/index.ts                  # + re-export data types & DataPort
packages/core/test/data/types.test.ts       # compile + export check

packages/db-testing/                         # @saytu/db-testing (private)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/index.ts                             # runDataPortContract(makeAdapter)
└── test/memory-adapter.test.ts             # self-test: contract vs in-memory adapter

packages/db-sqlite/                          # @saytu/db-sqlite
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── drizzle/                                 # generated migration (committed)
├── src/
│   ├── schema.ts                            # drafts, locks (Drizzle sqlite-core)
│   ├── adapter.ts                           # createSqliteAdapter(file): DataPort
│   └── index.ts
└── test/contract.test.ts                    # runDataPortContract(() => createSqliteAdapter(':memory:'))

package.json                                 # + better-sqlite3 in pnpm.onlyBuiltDependencies
```

---

### Task 1: `DataPort` interface + domain types in `@saytu/core`

**Files:**
- Create: `packages/core/src/data/types.ts`
- Create: `packages/core/src/data/data-port.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/data/types.test.ts`

- [ ] **Step 1: Create the domain types**

Create `packages/core/src/data/types.ts`:

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

/** A pessimistic edit lock on an entry (PRD §9). TTL policy lives in core. */
export interface Lock extends EntryRef {
  lockedBy: string
  lockedAt: number
}
```

- [ ] **Step 2: Create the DataPort interface**

Create `packages/core/src/data/data-port.ts`:

```ts
import type { Draft, DraftInput, EntryRef, Lock } from './types'

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

- [ ] **Step 3: Write the failing test**

Create `packages/core/test/data/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { DataPort, Draft, DraftInput, EntryRef, Lock } from '../../src/index'

describe('DataPort domain types', () => {
  it('Draft / DraftInput / Lock shapes compile and carry the expected fields', () => {
    const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'x' }
    const draft: Draft = {
      ...ref,
      content: { type: 'doc', content: [] },
      metadata: { title: 'T' },
      baseSha: null,
      createdAt: 1,
      updatedAt: 2,
    }
    const input: DraftInput = { ...ref, content: { type: 'doc', content: [] }, metadata: {} }
    const lock: Lock = { ...ref, lockedBy: 'a@x.com', lockedAt: 1 }
    expect([draft.slug, input.collection, lock.lockedBy]).toEqual(['x', 'post', 'a@x.com'])
  })

  it('DataPort is structurally implementable', () => {
    const partial: Pick<DataPort, 'close'> = { close: async () => {} }
    expect(typeof partial.close).toBe('function')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- data/types`
Expected: FAIL — types not exported from `../../src/index`.

- [ ] **Step 5: Export the data surface from the package index**

Edit `packages/core/src/index.ts` — append:

```ts
export type { EntryRef, Draft, DraftInput, Lock } from './data/types'
export type { DataPort } from './data/data-port'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @saytu/core test -- data/types`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck (incl. edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean. (The DataPort types are pure and Node-free; `src/data` is not in the `src/markdoc` edge graph, so the edge guard is unaffected.)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/data packages/core/src/index.ts packages/core/test/data
git commit -m "feat(core): DataPort interface + drafts/locks domain types"
```

---

### Task 2: `@saytu/db-testing` — reusable contract suite + in-memory self-test

**Files:**
- Create: `packages/db-testing/package.json`
- Create: `packages/db-testing/tsconfig.json`
- Create: `packages/db-testing/vitest.config.ts`
- Create: `packages/db-testing/src/index.ts`
- Create: `packages/db-testing/test/memory-adapter.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/db-testing/package.json`:

```json
{
  "name": "@saytu/db-testing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@saytu/core": "workspace:*",
    "vitest": "^2.1.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

Create `packages/db-testing/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": [] },
  "include": ["src", "test"]
}
```

Create `packages/db-testing/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 2: Install (links the workspace deps)**

Run: `pnpm install`
Expected: clean; `@saytu/core` symlinked into `@saytu/db-testing`.

- [ ] **Step 3: Implement the contract suite**

Create `packages/db-testing/src/index.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DataPort, TiptapDoc } from '@saytu/core'

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Run the DataPort behavioral contract against an adapter. `makeAdapter` must
 *  return a FRESH, empty adapter (e.g. a new in-memory DB) on each call. */
export function runDataPortContract(makeAdapter: () => Promise<DataPort> | DataPort): void {
  describe('DataPort contract', () => {
    let db: DataPort
    beforeEach(async () => {
      db = await makeAdapter()
    })
    afterEach(async () => {
      await db.close()
    })

    // --- drafts ---
    it('returns null for an absent draft', async () => {
      expect(await db.getDraft({ collection: 'post', locale: 'en', slug: 'x' })).toBeNull()
    })

    it('saves and reads back a draft, round-tripping content/metadata/baseSha', async () => {
      const input = {
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('hi'),
        metadata: { title: 'Hello', n: 3 },
        baseSha: 'abc123',
      }
      const saved = await db.saveDraft(input)
      expect(saved).toMatchObject({
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('hi'),
        metadata: { title: 'Hello', n: 3 },
        baseSha: 'abc123',
      })
      expect(saved.createdAt).toBeTypeOf('number')
      expect(saved.updatedAt).toBeTypeOf('number')
      const got = await db.getDraft({ collection: 'post', locale: 'en', slug: 'hello' })
      expect(got).toEqual(saved)
    })

    it('defaults baseSha to null when omitted', async () => {
      const saved = await db.saveDraft({
        collection: 'post',
        locale: 'en',
        slug: 'no-sha',
        content: doc('x'),
        metadata: {},
      })
      expect(saved.baseSha).toBeNull()
    })

    it('upserts on the same ref: updates content, bumps updatedAt, keeps createdAt', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'up' }
      const first = await db.saveDraft({ ...ref, content: doc('one'), metadata: {} })
      const second = await db.saveDraft({ ...ref, content: doc('two'), metadata: { edited: true } })
      expect(second.createdAt).toBe(first.createdAt)
      expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
      expect(second.content).toEqual(doc('two'))
      expect(second.metadata).toEqual({ edited: true })
      const all = await db.listDrafts()
      expect(all.filter((d) => d.slug === 'up')).toHaveLength(1)
    })

    it('deletes a draft; deleting an absent draft is a no-op', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'del' }
      await db.saveDraft({ ...ref, content: doc('x'), metadata: {} })
      await db.deleteDraft(ref)
      expect(await db.getDraft(ref)).toBeNull()
      await expect(db.deleteDraft(ref)).resolves.toBeUndefined()
    })

    it('lists drafts and filters by collection', async () => {
      await db.saveDraft({ collection: 'post', locale: 'en', slug: 'a', content: doc('a'), metadata: {} })
      await db.saveDraft({ collection: 'page', locale: 'en', slug: 'b', content: doc('b'), metadata: {} })
      expect(await db.listDrafts()).toHaveLength(2)
      const posts = await db.listDrafts({ collection: 'post' })
      expect(posts).toHaveLength(1)
      expect(posts[0]!.slug).toBe('a')
    })

    it('isolates entries by full ref (same slug, different locale)', async () => {
      await db.saveDraft({ collection: 'post', locale: 'en', slug: 'same', content: doc('english'), metadata: {} })
      await db.saveDraft({ collection: 'post', locale: 'fr', slug: 'same', content: doc('french'), metadata: {} })
      const en = await db.getDraft({ collection: 'post', locale: 'en', slug: 'same' })
      const fr = await db.getDraft({ collection: 'post', locale: 'fr', slug: 'same' })
      expect(en!.content).toEqual(doc('english'))
      expect(fr!.content).toEqual(doc('french'))
      expect(await db.listDrafts()).toHaveLength(2)
    })

    // --- locks ---
    it('returns null for an absent lock', async () => {
      expect(await db.getLock({ collection: 'post', locale: 'en', slug: 'x' })).toBeNull()
    })

    it('puts and reads a lock', async () => {
      const lock = { collection: 'post', locale: 'en', slug: 'l', lockedBy: 'sarah@x.com', lockedAt: 1000 }
      await db.putLock(lock)
      expect(await db.getLock({ collection: 'post', locale: 'en', slug: 'l' })).toEqual(lock)
    })

    it('overwrites a lock on repeated put (last write wins)', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'l' }
      await db.putLock({ ...ref, lockedBy: 'a@x.com', lockedAt: 1 })
      await db.putLock({ ...ref, lockedBy: 'b@x.com', lockedAt: 2 })
      expect(await db.getLock(ref)).toEqual({ ...ref, lockedBy: 'b@x.com', lockedAt: 2 })
    })

    it('deletes a lock; deleting an absent lock is a no-op', async () => {
      const ref = { collection: 'post', locale: 'en', slug: 'l' }
      await db.putLock({ ...ref, lockedBy: 'a@x.com', lockedAt: 1 })
      await db.deleteLock(ref)
      expect(await db.getLock(ref)).toBeNull()
      await expect(db.deleteLock(ref)).resolves.toBeUndefined()
    })
  })
}
```

- [ ] **Step 4: Write the self-test (in-memory reference adapter)**

Create `packages/db-testing/test/memory-adapter.test.ts`:

```ts
import { runDataPortContract } from '../src/index'
import type { DataPort, Draft, EntryRef, Lock } from '@saytu/core'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`

/** A correct in-memory DataPort — proves the contract suite passes a valid
 *  implementation (and would fail a broken one). Doubles as a reference. */
function createMemoryAdapter(): DataPort {
  const drafts = new Map<string, Draft>()
  const locks = new Map<string, Lock>()
  return {
    async getDraft(ref) {
      return drafts.get(key(ref)) ?? null
    },
    async saveDraft(input) {
      const k = key(input)
      const now = Date.now()
      const existing = drafts.get(k)
      const draft: Draft = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
        content: input.content,
        metadata: input.metadata,
        baseSha: input.baseSha ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      drafts.set(k, draft)
      return draft
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

runDataPortContract(() => createMemoryAdapter())
```

- [ ] **Step 5: Run the self-test**

Run: `pnpm --filter @saytu/db-testing test`
Expected: PASS — the full DataPort contract (12 tests) green against the in-memory adapter.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @saytu/db-testing typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db-testing pnpm-lock.yaml
git commit -m "feat(db-testing): runDataPortContract + in-memory reference adapter"
```

---

### Task 3: `@saytu/db-sqlite` scaffold — schema + Drizzle-Kit migration

**Files:**
- Create: `packages/db-sqlite/package.json`
- Create: `packages/db-sqlite/tsconfig.json`
- Create: `packages/db-sqlite/vitest.config.ts`
- Create: `packages/db-sqlite/drizzle.config.ts`
- Create: `packages/db-sqlite/src/schema.ts`
- Modify: `package.json` (root — `pnpm.onlyBuiltDependencies`)
- Generated: `packages/db-sqlite/drizzle/**`

- [ ] **Step 1: Scaffold the package**

Create `packages/db-sqlite/package.json`:

```json
{
  "name": "@saytu/db-sqlite",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@saytu/core": "workspace:*"
  },
  "devDependencies": {
    "@saytu/db-testing": "workspace:*",
    "@types/node": "^22.10.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/db-sqlite/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

Create `packages/db-sqlite/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 2: Add the runtime + tooling dependencies**

Run (fetches current versions, writes them into package.json):

```bash
pnpm --filter @saytu/db-sqlite add drizzle-orm better-sqlite3
pnpm --filter @saytu/db-sqlite add -D drizzle-kit @types/better-sqlite3
```

Expected: both resolve and install.

- [ ] **Step 3: Allow better-sqlite3's native build**

Edit the ROOT `package.json` — change `pnpm.onlyBuiltDependencies` from `["esbuild"]` to:

```json
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild", "better-sqlite3"]
  }
```

Then run `pnpm install` and `pnpm rebuild better-sqlite3` (or `pnpm install` again) so the native binding builds. Verify there is no "better-sqlite3 was not built" warning blocking use.

Quick sanity check the binding loads:

```bash
node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); db.exec('create table t(x)'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 4: Create the Drizzle schema**

Create `packages/db-sqlite/src/schema.ts`:

```ts
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const drafts = sqliteTable(
  'drafts',
  {
    collection: text('collection').notNull(),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    content: text('content').notNull(), // JSON (TiptapDoc)
    metadata: text('metadata').notNull(), // JSON
    baseSha: text('base_sha'), // nullable
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms
  },
  (t) => [primaryKey({ columns: [t.collection, t.locale, t.slug] })],
)

export const locks = sqliteTable(
  'locks',
  {
    collection: text('collection').notNull(),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    lockedBy: text('locked_by').notNull(),
    lockedAt: integer('locked_at').notNull(), // epoch ms
  },
  (t) => [primaryKey({ columns: [t.collection, t.locale, t.slug] })],
)
```

- [ ] **Step 5: Create the Drizzle-Kit config**

Create `packages/db-sqlite/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
})
```

- [ ] **Step 6: Generate the initial migration**

Run: `pnpm --filter @saytu/db-sqlite db:generate`
Expected: creates `packages/db-sqlite/drizzle/0000_*.sql` plus `packages/db-sqlite/drizzle/meta/` (snapshot + `_journal.json`). The SQL should contain `CREATE TABLE \`drafts\`` and `CREATE TABLE \`locks\`` with the composite primary keys.

Verify: `cat packages/db-sqlite/drizzle/*.sql` shows both `CREATE TABLE` statements.

(If `db:generate` is interactive or errors on this Drizzle-Kit version, STOP and report BLOCKED with the exact output — do not hand-fake the migration meta files.)

- [ ] **Step 7: Typecheck the scaffold**

Run: `pnpm --filter @saytu/db-sqlite typecheck`
Expected: clean (schema + config compile).

- [ ] **Step 8: Commit**

```bash
git add packages/db-sqlite/package.json packages/db-sqlite/tsconfig.json packages/db-sqlite/vitest.config.ts packages/db-sqlite/drizzle.config.ts packages/db-sqlite/src/schema.ts packages/db-sqlite/drizzle package.json pnpm-lock.yaml
git commit -m "feat(db-sqlite): package scaffold + drizzle schema + initial migration"
```

---

### Task 4: `db-sqlite` adapter passes the DataPort contract

**Files:**
- Create: `packages/db-sqlite/src/adapter.ts`
- Create: `packages/db-sqlite/src/index.ts`
- Test: `packages/db-sqlite/test/contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `packages/db-sqlite/test/contract.test.ts`:

```ts
import { runDataPortContract } from '@saytu/db-testing'
import { createSqliteAdapter } from '../src/index'

runDataPortContract(() => createSqliteAdapter(':memory:'))
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @saytu/db-sqlite test`
Expected: FAIL — `createSqliteAdapter` is not exported / module missing.

- [ ] **Step 3: Implement the adapter**

Create `packages/db-sqlite/src/adapter.ts`:

```ts
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DataPort, Draft, EntryRef } from '@saytu/core'
import { drafts, locks } from './schema'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle')

type DraftRow = typeof drafts.$inferSelect

const rowToDraft = (r: DraftRow): Draft => ({
  collection: r.collection,
  locale: r.locale,
  slug: r.slug,
  content: JSON.parse(r.content) as Draft['content'],
  metadata: JSON.parse(r.metadata) as Record<string, unknown>,
  baseSha: r.baseSha,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

/** Create a better-sqlite3-backed DataPort. `file` is a path or ':memory:'. */
export function createSqliteAdapter(file: string): DataPort {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  const whereDraft = (ref: EntryRef) =>
    and(eq(drafts.collection, ref.collection), eq(drafts.locale, ref.locale), eq(drafts.slug, ref.slug))
  const whereLock = (ref: EntryRef) =>
    and(eq(locks.collection, ref.collection), eq(locks.locale, ref.locale), eq(locks.slug, ref.slug))

  const readDraft = (ref: EntryRef): Draft | null => {
    const row = db.select().from(drafts).where(whereDraft(ref)).get()
    return row ? rowToDraft(row) : null
  }

  return {
    async getDraft(ref) {
      return readDraft(ref)
    },
    async saveDraft(input) {
      const now = Date.now()
      const content = JSON.stringify(input.content)
      const metadata = JSON.stringify(input.metadata)
      const baseSha = input.baseSha ?? null
      db.insert(drafts)
        .values({
          collection: input.collection,
          locale: input.locale,
          slug: input.slug,
          content,
          metadata,
          baseSha,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [drafts.collection, drafts.locale, drafts.slug],
          set: { content, metadata, baseSha, updatedAt: now },
        })
        .run()
      return readDraft(input)!
    },
    async deleteDraft(ref) {
      db.delete(drafts).where(whereDraft(ref)).run()
    },
    async listDrafts(filter) {
      const rows = filter?.collection
        ? db.select().from(drafts).where(eq(drafts.collection, filter.collection)).all()
        : db.select().from(drafts).all()
      return rows.map(rowToDraft)
    },
    async getLock(ref) {
      const row = db.select().from(locks).where(whereLock(ref)).get()
      return row
        ? { collection: row.collection, locale: row.locale, slug: row.slug, lockedBy: row.lockedBy, lockedAt: row.lockedAt }
        : null
    },
    async putLock(lock) {
      db.insert(locks)
        .values({
          collection: lock.collection,
          locale: lock.locale,
          slug: lock.slug,
          lockedBy: lock.lockedBy,
          lockedAt: lock.lockedAt,
        })
        .onConflictDoUpdate({
          target: [locks.collection, locks.locale, locks.slug],
          set: { lockedBy: lock.lockedBy, lockedAt: lock.lockedAt },
        })
        .run()
    },
    async deleteLock(ref) {
      db.delete(locks).where(whereLock(ref)).run()
    },
    async close() {
      sqlite.close()
    },
  }
}
```

- [ ] **Step 4: Create the package entry**

Create `packages/db-sqlite/src/index.ts`:

```ts
export { createSqliteAdapter } from './adapter'
```

- [ ] **Step 5: Run the contract test**

Run: `pnpm --filter @saytu/db-sqlite test`
Expected: PASS — the full DataPort contract (12 tests) green against the in-memory SQLite adapter.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @saytu/db-sqlite typecheck`
Expected: clean.

- [ ] **Step 7: Full repo verification (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: every package green — `@saytu/core` (39 tests: 37 prior + 2 new data-types), `@saytu/db-testing` (12), `@saytu/db-sqlite` (12); typecheck clean across all packages including the core edge guard.

- [ ] **Step 8: Commit**

```bash
git add packages/db-sqlite/src/adapter.ts packages/db-sqlite/src/index.ts packages/db-sqlite/test/contract.test.ts
git commit -m "feat(db-sqlite): DataPort adapter passing the shared contract"
```

---

## Self-Review

**Spec coverage:**
- `DataPort` interface + `EntryRef`/`Draft`/`DraftInput`/`Lock` in `@saytu/core/src/data` → Task 1. ✓
- Async port surface (drafts CRUD + listDrafts + lock get/put/delete + close) → Task 1 interface; exercised in Tasks 2 & 4. ✓
- `@saytu/db-testing` exporting `runDataPortContract` → Task 2; self-tested vs in-memory reference adapter → Task 2 Step 4. ✓
- `@saytu/db-sqlite` with Drizzle + better-sqlite3, composite-PK `drafts`/`locks` schema, Drizzle-Kit migration applied on init → Tasks 3 & 4. ✓
- better-sqlite3 in root `pnpm.onlyBuiltDependencies` → Task 3 Step 3. ✓
- Contract assertions: null-on-absent, save/read round-trip (content+metadata+baseSha), baseSha default null, upsert (createdAt stable / updatedAt bump / content change), delete + absent-delete no-op, listDrafts + collection filter, ref isolation, lock get/put/overwrite/delete → Task 2 Step 3. ✓
- Existing 37 core tests stay green; core edge guard unaffected (data types Node-free, not in markdoc edge graph) → Task 1 Step 7, Task 4 Step 7. ✓
- Deferred (content index/FTS5, lock TTL orchestration, users/submissions, db-d1) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases". Generated migration files (Task 3 Step 6) are tool-produced artifacts with an exact command + a content assertion + an explicit BLOCKED path if the CLI misbehaves — not a placeholder. ✓

**Type consistency:** `EntryRef`/`Draft`/`DraftInput`/`Lock`/`DataPort` signatures are defined once in Task 1 and consumed identically in the contract suite (Task 2), the memory adapter (Task 2), and the SQLite adapter (Task 4). Schema columns (`base_sha`, `created_at`, `updated_at`, `locked_by`, `locked_at`) map to `baseSha`/`createdAt`/`updatedAt`/`lockedBy`/`lockedAt` via Drizzle field names; `rowToDraft` maps them back. `createSqliteAdapter(file: string): DataPort` and `runDataPortContract(makeAdapter)` signatures match their call sites. ✓
