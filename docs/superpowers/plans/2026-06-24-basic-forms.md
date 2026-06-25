# Basic Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a basic forms capability — a `contact` block, a spam-resistant submission pipeline, email notification, and an admin submissions inbox — working end-to-end in dev + self-hosted topologies.

**Architecture:** Two new ports mirroring the existing `DataPort`/`GitPort` grain — `SubmissionPort` (DB storage for submissions) and `EmailPort` (provider-agnostic send) — plus a topology-agnostic `createSubmissionService` holding the submit pipeline (honeypot → Turnstile verify → validate → persist → best-effort notify). The static site renders a `contact` block whose React island POSTs to `apps/api`; the admin inbox reads/manages submissions over an HTTP adapter (Cut A topology), exactly like `git-http`.

**Tech Stack:** TypeScript (ESM), pnpm workspaces, Zod, Drizzle + better-sqlite3, Hono, Astro 7 + `@astrojs/react` (React 19), Vitest, Cloudflare Turnstile, Resend + React Email (Phase 5).

## Global Constraints

- **Package manager:** pnpm `10.33.0`. Workspace deps use `"workspace:*"` (never version strings). After adding a package or dep, run `pnpm install` from the repo root.
- **Package layout:** new packages are `@setu/<name>`; `package.json` sets `"type": "module"`, `main`/`types`/`exports` → `./src/index.ts` (no build step); `license: "AGPL-3.0-only"`; `tsconfig.json` extends `../../tsconfig.base.json` with `{ "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }`.
- **TS config (inherited):** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, ESNext/bundler. Use `import type` for type-only imports.
- **Tests:** Vitest. Adapter tests live in `test/` (not collocated). Core unit tests collocate under `packages/core/test/` per existing convention.
- **TDD:** every task writes the failing test first, runs it red, implements minimally, runs it green, commits.
- **Commits:** small and frequent; conventional-commit style (`feat:`/`test:`/`chore:`), end with the Co-Authored-By trailer used in this repo.
- **Cloudflare-safe / cost-safe:** no per-request cost surprises; v1 targets dev + self-hosted (`apps/api` + `db-sqlite`). Edge adapters (`db-d1`, `email-cloudflare`) are out of scope but must remain drop-in behind the ports.
- **Data rule:** submissions are runtime data → **DB only**, never Git. No `GitPort` usage anywhere in this feature.
- **Spam:** rejected at submit time (honeypot + Turnstile). There is **no spam status** in storage or the inbox.
- **Verify before done:** run `pnpm -r typecheck` and the relevant package tests before claiming a task complete.

---

## Phase 1 — Core storage + service (backend pipeline, console email)

**Deliverable:** `createSubmissionService.submit()` works against an in-memory + sqlite `SubmissionPort`, blocks spam, validates, persists, and notifies via a console `EmailPort`. All unit-tested. No HTTP/UI yet.

### Task 1: `SubmissionPort` interface, types, and pure `selectDistinctForms` helper

**Files:**
- Create: `packages/core/src/submissions/types.ts`
- Create: `packages/core/src/submissions/submission-port.ts`
- Create: `packages/core/src/submissions/distinct-forms.ts`
- Create: `packages/core/test/submissions/distinct-forms.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Interfaces:**
- Produces: `Submission`, `SubmissionInput`, `SubmissionFilter`, `FormSummary`, `SubmissionPort`, `selectDistinctForms(rows: Submission[]): FormSummary[]`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/submissions/distinct-forms.test.ts
import { describe, it, expect } from 'vitest'
import { selectDistinctForms } from '../../src/submissions/distinct-forms'
import type { Submission } from '../../src/submissions/types'

const sub = (formId: string, formLabel: string | undefined, createdAt: number): Submission => ({
  id: `${formId}-${createdAt}`,
  formId,
  formLabel,
  fields: {},
  createdAt,
  read: false,
})

describe('selectDistinctForms', () => {
  it('groups by formId with counts, newest label wins, sorted by formId', () => {
    const rows: Submission[] = [
      sub('contact', 'Contact', 100),
      sub('contact', 'Contact Us', 200), // newer → label wins
      sub('apply', 'Apply', 150),
    ]
    expect(selectDistinctForms(rows)).toEqual([
      { formId: 'apply', formLabel: 'Apply', count: 1 },
      { formId: 'contact', formLabel: 'Contact Us', count: 2 },
    ])
  })

  it('returns [] for no rows', () => {
    expect(selectDistinctForms([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- distinct-forms`
Expected: FAIL — cannot find module `distinct-forms` / `selectDistinctForms is not a function`.

- [ ] **Step 3: Write the types + port + helper**

```typescript
// packages/core/src/submissions/types.ts
/** A stored form submission. Runtime data — DB only, never Git. */
export interface Submission {
  id: string
  /** Stable id of the form that produced this (the block's `formId` prop). */
  formId: string
  /** Human label for the inbox; falls back to formId when absent. */
  formLabel?: string
  /** Submitted field values (name/email/subject/message). */
  fields: Record<string, string>
  /** Epoch ms, assigned by the adapter. */
  createdAt: number
  /** Triage flag for the inbox. */
  read: boolean
  /** Best-effort request provenance. */
  source?: { url?: string; referrer?: string; userAgent?: string }
}

/** Input to saveSubmission; the adapter assigns id/createdAt and defaults read=false. */
export interface SubmissionInput {
  formId: string
  formLabel?: string
  fields: Record<string, string>
  source?: { url?: string; referrer?: string; userAgent?: string }
}

/** Listing filter. `q` is a basic case-insensitive substring match over field values. */
export interface SubmissionFilter {
  formId?: string
  read?: boolean
  q?: string
  limit?: number
  offset?: number
}

/** Inbox form-filter row. */
export interface FormSummary {
  formId: string
  formLabel?: string
  count: number
}
```

```typescript
// packages/core/src/submissions/submission-port.ts
import type { Submission, SubmissionFilter, SubmissionInput, FormSummary } from './types'

/** Storage for form submissions. The DB is the source of truth for submissions
 *  (runtime data, never Git). Mirrors the DataPort grain. */
export interface SubmissionPort {
  /** Insert; assigns id + createdAt, read=false. Returns the stored row. */
  saveSubmission(input: SubmissionInput): Promise<Submission>
  getSubmission(id: string): Promise<Submission | null>
  /** Newest-first; returns the filtered page plus the unpaged total. */
  listSubmissions(filter?: SubmissionFilter): Promise<{ rows: Submission[]; total: number }>
  /** Idempotent bulk read/unread; ignores ids that do not exist. */
  setRead(ids: string[], read: boolean): Promise<void>
  /** Bulk delete; ignores ids that do not exist. */
  deleteSubmissions(ids: string[]): Promise<void>
  /** Distinct forms with counts, for the inbox filter. */
  distinctForms(): Promise<FormSummary[]>
  close(): Promise<void>
}
```

```typescript
// packages/core/src/submissions/distinct-forms.ts
import type { Submission, FormSummary } from './types'

/** Group submissions by formId with counts; the most-recent submission's label
 *  wins; sorted by formId. The single impl shared by every SubmissionPort adapter. */
export function selectDistinctForms(rows: Submission[]): FormSummary[] {
  const byId = new Map<string, { label?: string; labelAt: number; count: number }>()
  for (const r of rows) {
    const cur = byId.get(r.formId)
    if (!cur) {
      byId.set(r.formId, { label: r.formLabel, labelAt: r.createdAt, count: 1 })
    } else {
      cur.count++
      if (r.createdAt >= cur.labelAt) {
        cur.label = r.formLabel
        cur.labelAt = r.createdAt
      }
    }
  }
  return [...byId.entries()]
    .map(([formId, v]) => ({ formId, formLabel: v.label, count: v.count }))
    .sort((a, b) => a.formId.localeCompare(b.formId))
}
```

- [ ] **Step 4: Add barrel exports**

In `packages/core/src/index.ts`, add (next to the other port exports):

```typescript
export type { Submission, SubmissionInput, SubmissionFilter, FormSummary } from './submissions/types'
export type { SubmissionPort } from './submissions/submission-port'
export { selectDistinctForms } from './submissions/distinct-forms'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- distinct-forms`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/submissions packages/core/test/submissions packages/core/src/index.ts
git commit -m "feat(core): SubmissionPort interface + types + selectDistinctForms"
```

---

### Task 2: `runSubmissionPortContract` harness

**Files:**
- Modify: `packages/db-testing/src/index.ts` (add the contract export)
- Modify: `packages/db-testing/package.json` is unchanged (already depends on `@setu/core`)

**Interfaces:**
- Consumes: `SubmissionPort`, `Submission` (Task 1).
- Produces: `runSubmissionPortContract(makeAdapter: () => Promise<SubmissionPort> | SubmissionPort): void`.

- [ ] **Step 1: Write the contract (it is the test; adapters in Tasks 3–4 invoke it)**

Append to `packages/db-testing/src/index.ts`:

```typescript
import type { SubmissionPort } from '@setu/core'

/** Run the SubmissionPort behavioral contract against an adapter. `makeAdapter`
 *  must return a FRESH, empty adapter on each call. */
export function runSubmissionPortContract(makeAdapter: () => Promise<SubmissionPort> | SubmissionPort): void {
  describe('SubmissionPort contract', () => {
    let db: SubmissionPort
    beforeEach(async () => {
      db = await makeAdapter()
    })
    afterEach(async () => {
      await db.close()
    })

    const input = (over: Partial<Parameters<SubmissionPort['saveSubmission']>[0]> = {}) => ({
      formId: 'contact',
      formLabel: 'Contact',
      fields: { name: 'Ada', email: 'ada@x.com', message: 'hi' },
      ...over,
    })

    it('assigns id + createdAt, defaults read=false, round-trips fields', async () => {
      const saved = await db.saveSubmission(input())
      expect(saved.id).toBeTypeOf('string')
      expect(saved.id.length).toBeGreaterThan(0)
      expect(saved.createdAt).toBeTypeOf('number')
      expect(saved.read).toBe(false)
      expect(saved.fields).toEqual({ name: 'Ada', email: 'ada@x.com', message: 'hi' })
      expect(await db.getSubmission(saved.id)).toEqual(saved)
    })

    it('returns null for an absent id', async () => {
      expect(await db.getSubmission('nope')).toBeNull()
    })

    it('lists newest-first with total', async () => {
      const a = await db.saveSubmission(input({ fields: { email: 'a@x.com', message: 'first' } }))
      const b = await db.saveSubmission(input({ fields: { email: 'b@x.com', message: 'second' } }))
      const { rows, total } = await db.listSubmissions()
      expect(total).toBe(2)
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]) // newest first
    })

    it('filters by formId and by read', async () => {
      const c = await db.saveSubmission(input({ formId: 'contact' }))
      await db.saveSubmission(input({ formId: 'apply' }))
      await db.setRead([c.id], true)
      expect((await db.listSubmissions({ formId: 'apply' })).total).toBe(1)
      expect((await db.listSubmissions({ read: true })).rows.map((r) => r.id)).toEqual([c.id])
      expect((await db.listSubmissions({ read: false })).total).toBe(1)
    })

    it('searches q over field values (case-insensitive substring)', async () => {
      await db.saveSubmission(input({ fields: { email: 'a@x.com', message: 'Need a QUOTE please' } }))
      await db.saveSubmission(input({ fields: { email: 'b@x.com', message: 'just saying hi' } }))
      const { rows, total } = await db.listSubmissions({ q: 'quote' })
      expect(total).toBe(1)
      expect(rows[0]!.fields.message).toContain('QUOTE')
    })

    it('paginates with limit/offset while total stays unpaged', async () => {
      for (let i = 0; i < 5; i++) await db.saveSubmission(input({ fields: { email: `u${i}@x.com`, message: `m${i}` } }))
      const page = await db.listSubmissions({ limit: 2, offset: 2 })
      expect(page.total).toBe(5)
      expect(page.rows).toHaveLength(2)
    })

    it('setRead is idempotent and ignores unknown ids', async () => {
      const a = await db.saveSubmission(input())
      await db.setRead([a.id, 'ghost'], true)
      await db.setRead([a.id], true)
      expect((await db.getSubmission(a.id))!.read).toBe(true)
      await db.setRead([a.id], false)
      expect((await db.getSubmission(a.id))!.read).toBe(false)
    })

    it('deletes in bulk and ignores unknown ids', async () => {
      const a = await db.saveSubmission(input())
      const b = await db.saveSubmission(input())
      await db.deleteSubmissions([a.id, 'ghost'])
      expect(await db.getSubmission(a.id)).toBeNull()
      expect((await db.listSubmissions()).total).toBe(1)
      expect((await db.listSubmissions()).rows[0]!.id).toBe(b.id)
    })

    it('distinctForms groups with counts, newest label wins', async () => {
      await db.saveSubmission(input({ formId: 'contact', formLabel: 'Contact' }))
      await db.saveSubmission(input({ formId: 'contact', formLabel: 'Contact Us' }))
      await db.saveSubmission(input({ formId: 'apply', formLabel: 'Apply' }))
      expect(await db.distinctForms()).toEqual([
        { formId: 'apply', formLabel: 'Apply', count: 1 },
        { formId: 'contact', formLabel: 'Contact Us', count: 2 },
      ])
    })
  })
}
```

- [ ] **Step 2: Verify db-testing typechecks**

Run: `pnpm --filter @setu/db-testing typecheck`
Expected: PASS (no callers yet; the export compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/db-testing/src/index.ts
git commit -m "test(db-testing): runSubmissionPortContract harness"
```

---

### Task 3: in-memory `SubmissionPort` adapter (`db-memory`)

**Files:**
- Create: `packages/db-memory/src/submission-port.ts`
- Modify: `packages/db-memory/src/index.ts` (export it)
- Create: `packages/db-memory/test/submission-contract.test.ts`

**Interfaces:**
- Consumes: `runSubmissionPortContract` (Task 2), `SubmissionPort`/`Submission` (Task 1).
- Produces: `createMemorySubmissionPort(seed?: SubmissionInput[]): SubmissionPort`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db-memory/test/submission-contract.test.ts
import { runSubmissionPortContract } from '@setu/db-testing'
import { createMemorySubmissionPort } from '../src/index'

runSubmissionPortContract(() => createMemorySubmissionPort())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/db-memory test -- submission-contract`
Expected: FAIL — `createMemorySubmissionPort` is not exported.

- [ ] **Step 3: Implement the adapter**

```typescript
// packages/db-memory/src/submission-port.ts
import type { SubmissionPort, Submission, SubmissionInput } from '@setu/core'
import { selectDistinctForms } from '@setu/core'

/** In-memory SubmissionPort (Map-backed, browser-safe). Value semantics via
 *  structuredClone so callers cannot mutate stored rows. Mirrors db-memory's
 *  DataPort adapter. */
export function createMemorySubmissionPort(seed: SubmissionInput[] = []): SubmissionPort {
  const rows = new Map<string, Submission>()

  const put = (input: SubmissionInput): Submission => {
    const stored: Submission = structuredClone({
      id: crypto.randomUUID(),
      formId: input.formId,
      formLabel: input.formLabel,
      fields: input.fields,
      source: input.source,
      createdAt: Date.now(),
      read: false,
    })
    rows.set(stored.id, stored)
    return structuredClone(stored)
  }

  for (const s of seed) put(s)

  const matchesQ = (s: Submission, q: string) =>
    Object.values(s.fields).some((v) => v.toLowerCase().includes(q.toLowerCase()))

  return {
    async saveSubmission(input) {
      return put(input)
    },
    async getSubmission(id) {
      const r = rows.get(id)
      return r ? structuredClone(r) : null
    },
    async listSubmissions(filter) {
      let all = [...rows.values()]
      if (filter?.formId !== undefined) all = all.filter((r) => r.formId === filter.formId)
      if (filter?.read !== undefined) all = all.filter((r) => r.read === filter.read)
      if (filter?.q) all = all.filter((r) => matchesQ(r, filter.q!))
      all.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      const total = all.length
      const offset = filter?.offset ?? 0
      const limit = filter?.limit ?? all.length
      return { rows: all.slice(offset, offset + limit).map((r) => structuredClone(r)), total }
    },
    async setRead(ids, read) {
      for (const id of ids) {
        const r = rows.get(id)
        if (r) r.read = read
      }
    },
    async deleteSubmissions(ids) {
      for (const id of ids) rows.delete(id)
    },
    async distinctForms() {
      return selectDistinctForms([...rows.values()])
    },
    async close() {},
  }
}
```

Add to `packages/db-memory/src/index.ts`:

```typescript
export { createMemorySubmissionPort } from './submission-port'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/db-memory test -- submission-contract`
Expected: PASS (full SubmissionPort contract).

- [ ] **Step 5: Commit**

```bash
git add packages/db-memory/src/submission-port.ts packages/db-memory/src/index.ts packages/db-memory/test/submission-contract.test.ts
git commit -m "feat(db-memory): in-memory SubmissionPort adapter"
```

---

### Task 4: sqlite `SubmissionPort` adapter (`db-sqlite`)

**Files:**
- Modify: `packages/db-sqlite/src/schema.ts` (add `submissions` table)
- Create: `packages/db-sqlite/src/submission-port.ts`
- Modify: `packages/db-sqlite/src/index.ts` (export it)
- Create: `packages/db-sqlite/test/submission-contract.test.ts`
- Generate: a new migration under `packages/db-sqlite/drizzle/`

**Interfaces:**
- Consumes: `runSubmissionPortContract` (Task 2), `SubmissionPort` (Task 1).
- Produces: `createSqliteSubmissionPort(file: string): SubmissionPort`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db-sqlite/test/submission-contract.test.ts
import { runSubmissionPortContract } from '@setu/db-testing'
import { createSqliteSubmissionPort } from '../src/index'

runSubmissionPortContract(() => createSqliteSubmissionPort(':memory:'))
```

- [ ] **Step 2: Add the `submissions` table to the schema**

Append to `packages/db-sqlite/src/schema.ts`:

```typescript
export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull(),
  formLabel: text('form_label'), // nullable
  fields: text('fields').notNull(), // JSON
  createdAt: integer('created_at').notNull(), // epoch ms
  read: integer('read').notNull(), // 0/1
  sourceUrl: text('source_url'),
  sourceReferrer: text('source_referrer'),
  sourceUserAgent: text('source_user_agent'),
})
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @setu/db-sqlite db:generate`
Expected: a new file `packages/db-sqlite/drizzle/0001_*.sql` containing `CREATE TABLE \`submissions\` (...)`. Commit it with the code (the adapter's `migrate()` runs it). Verify it includes all nine columns and the `id` primary key.

- [ ] **Step 4: Implement the adapter**

```typescript
// packages/db-sqlite/src/submission-port.ts
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { SubmissionPort, Submission, SubmissionInput } from '@setu/core'
import { selectDistinctForms } from '@setu/core'
import { submissions } from './schema'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle')

type Row = typeof submissions.$inferSelect

const rowToSubmission = (r: Row): Submission => {
  const source =
    r.sourceUrl || r.sourceReferrer || r.sourceUserAgent
      ? {
          ...(r.sourceUrl ? { url: r.sourceUrl } : {}),
          ...(r.sourceReferrer ? { referrer: r.sourceReferrer } : {}),
          ...(r.sourceUserAgent ? { userAgent: r.sourceUserAgent } : {}),
        }
      : undefined
  return {
    id: r.id,
    formId: r.formId,
    formLabel: r.formLabel ?? undefined,
    fields: JSON.parse(r.fields) as Record<string, string>,
    createdAt: r.createdAt,
    read: r.read === 1,
    ...(source ? { source } : {}),
  }
}

/** Create a better-sqlite3-backed SubmissionPort. `file` is a path or ':memory:'. */
export function createSqliteSubmissionPort(file: string): SubmissionPort {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  const read = (id: string): Submission | null => {
    const row = db.select().from(submissions).where(eq(submissions.id, id)).get()
    return row ? rowToSubmission(row) : null
  }

  return {
    async saveSubmission(input: SubmissionInput) {
      const id = crypto.randomUUID()
      db.insert(submissions)
        .values({
          id,
          formId: input.formId,
          formLabel: input.formLabel ?? null,
          fields: JSON.stringify(input.fields),
          createdAt: Date.now(),
          read: 0,
          sourceUrl: input.source?.url ?? null,
          sourceReferrer: input.source?.referrer ?? null,
          sourceUserAgent: input.source?.userAgent ?? null,
        })
        .run()
      return read(id)!
    },
    async getSubmission(id) {
      return read(id)
    },
    async listSubmissions(filter) {
      const conds = []
      if (filter?.formId !== undefined) conds.push(eq(submissions.formId, filter.formId))
      if (filter?.read !== undefined) conds.push(eq(submissions.read, filter.read ? 1 : 0))
      // q: case-insensitive substring over the JSON fields blob. Good enough for v1
      // (documented basic search); a column/FTS index is a later optimization.
      if (filter?.q) conds.push(like(sql`lower(${submissions.fields})`, `%${filter.q.toLowerCase()}%`))
      const where = conds.length ? and(...conds) : undefined

      const totalRow = db
        .select({ n: sql<number>`count(*)` })
        .from(submissions)
        .where(where)
        .get()
      const total = totalRow?.n ?? 0

      let qy = db.select().from(submissions).where(where).orderBy(desc(submissions.createdAt), desc(submissions.id)).$dynamic()
      if (filter?.limit !== undefined) qy = qy.limit(filter.limit)
      if (filter?.offset !== undefined) qy = qy.offset(filter.offset)
      return { rows: qy.all().map(rowToSubmission), total }
    },
    async setRead(ids, readFlag) {
      if (ids.length === 0) return
      for (const id of ids) db.update(submissions).set({ read: readFlag ? 1 : 0 }).where(eq(submissions.id, id)).run()
    },
    async deleteSubmissions(ids) {
      for (const id of ids) db.delete(submissions).where(eq(submissions.id, id)).run()
    },
    async distinctForms() {
      return selectDistinctForms(db.select().from(submissions).all().map(rowToSubmission))
    },
    async close() {
      sqlite.close()
    },
  }
}
```

Add to `packages/db-sqlite/src/index.ts`:

```typescript
export { createSqliteSubmissionPort } from './submission-port'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/db-sqlite test -- submission-contract`
Expected: PASS (full SubmissionPort contract). If `like` on the JSON blob misbehaves, confirm `lower()` wrapping; the memory adapter is the reference behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/db-sqlite/src/schema.ts packages/db-sqlite/src/submission-port.ts packages/db-sqlite/src/index.ts packages/db-sqlite/drizzle packages/db-sqlite/test/submission-contract.test.ts
git commit -m "feat(db-sqlite): sqlite SubmissionPort adapter + submissions table"
```

---

### Task 5: `EmailPort` + `email-console` adapter

**Files:**
- Create: `packages/core/src/email/email-port.ts`
- Modify: `packages/core/src/index.ts` (export `EmailPort`, `EmailMessage`)
- Create package: `packages/email-console/` (`package.json`, `tsconfig.json`, `src/index.ts`, `test/console.test.ts`)

**Interfaces:**
- Produces: `EmailMessage`, `EmailPort` (core); `createConsoleEmailAdapter(log?): EmailPort`.

- [ ] **Step 1: Define the port in core**

```typescript
// packages/core/src/email/email-port.ts
/** A single outbound email. `html` is required; `text` is an optional plaintext
 *  alternative. Provider-agnostic — adapters map this to their SDK/binding. */
export interface EmailMessage {
  to: string
  from: string
  subject: string
  html: string
  text?: string
}

/** Provider-agnostic email sender. Implementations: console (dev), resend,
 *  ses, smtp, cloudflare. */
export interface EmailPort {
  send(msg: EmailMessage): Promise<void>
}
```

Add to `packages/core/src/index.ts`:

```typescript
export type { EmailMessage, EmailPort } from './email/email-port'
```

- [ ] **Step 2: Scaffold the package + failing test**

Create `packages/email-console/package.json`:

```json
{
  "name": "@setu/email-console",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

Create `packages/email-console/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

Create `packages/email-console/test/console.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createConsoleEmailAdapter } from '../src/index'

describe('console email adapter', () => {
  it('logs the message and resolves', async () => {
    const log = vi.fn()
    const adapter = createConsoleEmailAdapter(log)
    await adapter.send({ to: 'me@x.com', from: 'site@x.com', subject: 'New', html: '<p>hi</p>' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]![0])).toContain('me@x.com')
    expect(String(log.mock.calls[0]![0])).toContain('New')
  })
})
```

- [ ] **Step 3: Run install + test (red)**

Run: `pnpm install && pnpm --filter @setu/email-console test`
Expected: FAIL — module `../src/index` not found.

- [ ] **Step 4: Implement**

Create `packages/email-console/src/index.ts`:

```typescript
import type { EmailPort, EmailMessage } from '@setu/core'

/** Zero-config dev adapter: logs the email instead of sending. */
export function createConsoleEmailAdapter(log: (line: string) => void = console.log): EmailPort {
  return {
    async send(msg: EmailMessage) {
      log(`[email-console] to=${msg.to} from=${msg.from} subject=${JSON.stringify(msg.subject)}\n${msg.text ?? msg.html}`)
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/email-console test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/email packages/core/src/index.ts packages/email-console
git commit -m "feat(core,email-console): EmailPort interface + console adapter"
```

---

### Task 6: Turnstile verifier

**Files:**
- Create: `packages/core/src/submissions/turnstile.ts`
- Modify: `packages/core/src/index.ts` (export)
- Create: `packages/core/test/submissions/turnstile.test.ts`

**Interfaces:**
- Produces: `TurnstileVerifier = (token: string, remoteip?: string) => Promise<boolean>`; `createTurnstileVerifier(secret: string, fetchImpl?: typeof fetch): TurnstileVerifier`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/submissions/turnstile.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createTurnstileVerifier } from '../../src/submissions/turnstile'

const fakeFetch = (success: boolean) =>
  vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 })) as unknown as typeof fetch

describe('createTurnstileVerifier', () => {
  it('returns true when Cloudflare reports success', async () => {
    const verify = createTurnstileVerifier('secret', fakeFetch(true))
    expect(await verify('token', '1.2.3.4')).toBe(true)
  })

  it('returns false when Cloudflare reports failure', async () => {
    const verify = createTurnstileVerifier('secret', fakeFetch(false))
    expect(await verify('token')).toBe(false)
  })

  it('returns false when the request throws', async () => {
    const verify = createTurnstileVerifier('secret', (() => Promise.reject(new Error('net'))) as unknown as typeof fetch)
    expect(await verify('token')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- turnstile`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/submissions/turnstile.ts
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerifier = (token: string, remoteip?: string) => Promise<boolean>

/** Build a server-side Turnstile verifier. Fails CLOSED: any error/non-success
 *  → false (never let an unverifiable submission through). `fetchImpl` is
 *  injectable for tests. */
export function createTurnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): TurnstileVerifier {
  return async (token, remoteip) => {
    try {
      const body = new URLSearchParams({ secret, response: token })
      if (remoteip) body.set('remoteip', remoteip)
      const res = await fetchImpl(SITEVERIFY, { method: 'POST', body })
      if (!res.ok) return false
      const data = (await res.json()) as { success?: boolean }
      return data.success === true
    } catch {
      return false
    }
  }
}
```

Add to `packages/core/src/index.ts`:

```typescript
export { createTurnstileVerifier } from './submissions/turnstile'
export type { TurnstileVerifier } from './submissions/turnstile'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- turnstile`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/submissions/turnstile.ts packages/core/src/index.ts packages/core/test/submissions/turnstile.test.ts
git commit -m "feat(core): Turnstile server-side verifier (fails closed)"
```

---

### Task 7: `createSubmissionService` (the submit pipeline)

**Files:**
- Create: `packages/core/src/submissions/submission-service.ts`
- Modify: `packages/core/src/index.ts` (export)
- Create: `packages/core/test/submissions/submission-service.test.ts`

**Interfaces:**
- Consumes: `SubmissionPort`, `EmailPort`, `TurnstileVerifier`, `Submission`.
- Produces:
  - `SubmitInput = { formId: string; formLabel?: string; fields: Record<string,string>; turnstileToken: string; honeypot?: string; source?: Submission['source']; ip?: string }`
  - `SubmitResult = { ok: true; id?: string } | { ok: false; error: 'spam' | 'invalid' | 'server' }`
  - `NotificationContent = { subject: string; html: string; text?: string }`
  - `SubmissionService = { submit(input: SubmitInput): Promise<SubmitResult> }`
  - `createSubmissionService(deps): SubmissionService`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/test/submissions/submission-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSubmissionService } from '../../src/submissions/submission-service'
import { createMemorySubmissionPort } from '@setu/db-memory'
import type { EmailPort } from '../../src/email/email-port'

const ok = async () => true
const base = {
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hello there' },
  turnstileToken: 'tok',
}

describe('createSubmissionService.submit', () => {
  it('happy path: persists and returns ok with id', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('honeypot filled: silently drops (ok, nothing stored)', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    const r = await svc.submit({ ...base, honeypot: 'i am a bot' })
    expect(r).toEqual({ ok: true })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('turnstile fails: returns spam, nothing stored', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: async () => false })
    expect(await svc.submit({ ...base })).toEqual({ ok: false, error: 'spam' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('invalid email: returns invalid, nothing stored', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    expect(await svc.submit({ ...base, fields: { email: 'nope', message: 'x' } })).toEqual({ ok: false, error: 'invalid' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('missing message: returns invalid', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    expect(await svc.submit({ ...base, fields: { email: 'a@x.com', message: '  ' } })).toEqual({ ok: false, error: 'invalid' })
  })

  it('notifies on success (best-effort) and survives email failure', async () => {
    const submissions = createMemorySubmissionPort()
    const send = vi.fn(async () => {
      throw new Error('provider down')
    })
    const email: EmailPort = { send }
    const svc = createSubmissionService({
      submissions,
      verifyTurnstile: ok,
      email,
      notifyTo: 'owner@x.com',
      notifyFrom: 'site@x.com',
    })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) }) // not failed by email error
    expect(send).toHaveBeenCalledTimes(1)
    expect((await submissions.listSubmissions()).total).toBe(1) // stored regardless
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- submission-service`
Expected: FAIL — module not found. (Note: this test imports `@setu/db-memory`; add it to `packages/core`'s devDependencies as `"@setu/db-memory": "workspace:*"`, then `pnpm install`.)

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/submissions/submission-service.ts
import type { SubmissionPort, Submission } from './submission-port'
import type { EmailPort } from '../email/email-port'
import type { TurnstileVerifier } from './turnstile'

export interface SubmitInput {
  formId: string
  formLabel?: string
  fields: Record<string, string>
  turnstileToken: string
  honeypot?: string
  source?: Submission['source']
  ip?: string
}

export type SubmitResult = { ok: true; id?: string } | { ok: false; error: 'spam' | 'invalid' | 'server' }

export interface NotificationContent {
  subject: string
  html: string
  text?: string
}

export interface SubmissionService {
  submit(input: SubmitInput): Promise<SubmitResult>
}

export interface SubmissionServiceDeps {
  submissions: SubmissionPort
  verifyTurnstile: TurnstileVerifier
  email?: EmailPort
  notifyTo?: string
  notifyFrom?: string
  /** Override the notification body. Defaults to a plain-text summary. May be
   *  async (React Email's render() is async — see Phase 5). */
  renderNotification?: (submission: Submission) => NotificationContent | Promise<NotificationContent>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const defaultRender = (s: Submission): NotificationContent => {
  const lines = Object.entries(s.fields).map(([k, v]) => `${k}: ${v}`)
  const text = `New submission on "${s.formLabel ?? s.formId}"\n\n${lines.join('\n')}`
  return {
    subject: `New submission: ${s.formLabel ?? s.formId}`,
    html: `<h2>New submission: ${s.formLabel ?? s.formId}</h2><ul>${Object.entries(s.fields)
      .map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`)
      .join('')}</ul>`,
    text,
  }
}

/** The topology-agnostic submit pipeline: honeypot → Turnstile → validate →
 *  persist → best-effort notify. Runs unchanged behind apps/api today and a
 *  Worker later. */
export function createSubmissionService(deps: SubmissionServiceDeps): SubmissionService {
  const { submissions, verifyTurnstile, email, notifyTo, notifyFrom } = deps
  const render = deps.renderNotification ?? defaultRender

  return {
    async submit(input) {
      // 1. Honeypot — bots fill it. Pretend success, store nothing (no signal).
      if (input.honeypot && input.honeypot.trim() !== '') return { ok: true }

      // 2. Turnstile (fails closed inside the verifier).
      if (!(await verifyTurnstile(input.turnstileToken, input.ip))) return { ok: false, error: 'spam' }

      // 3. Validate server-side floor: a valid email + a non-empty message.
      const emailVal = (input.fields.email ?? '').trim()
      const message = (input.fields.message ?? '').trim()
      if (!EMAIL_RE.test(emailVal) || message === '') return { ok: false, error: 'invalid' }

      // 4. Persist.
      let saved: Submission
      try {
        saved = await submissions.saveSubmission({
          formId: input.formId,
          formLabel: input.formLabel,
          fields: input.fields,
          source: input.source,
        })
      } catch {
        return { ok: false, error: 'server' }
      }

      // 5. Best-effort notify — never fails the submission.
      if (email && notifyTo && notifyFrom) {
        const content = await render(saved)
        try {
          await email.send({ to: notifyTo, from: notifyFrom, ...content })
        } catch (e) {
          console.error('[submission-service] notify failed', e)
        }
      }

      return { ok: true, id: saved.id }
    },
  }
}
```

Add to `packages/core/src/index.ts`:

```typescript
export { createSubmissionService } from './submissions/submission-service'
export type {
  SubmissionService,
  SubmissionServiceDeps,
  SubmitInput,
  SubmitResult,
  NotificationContent,
} from './submissions/submission-service'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- submission-service`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/submissions/submission-service.ts packages/core/src/index.ts packages/core/package.json packages/core/test/submissions/submission-service.test.ts
git commit -m "feat(core): createSubmissionService submit pipeline"
```

**Phase 1 checkpoint:** request review (`superpowers:requesting-code-review`) before Phase 2. The whole backend pipeline is unit-tested end-to-end with in-memory + sqlite storage and console email.

---

## Phase 2 — API surface (submit endpoint + admin CRUD + HTTP adapter)

**Deliverable:** `POST /forms/submit` (public) runs the pipeline over a real `apps/api`, plus auth-free admin CRUD routes (consistent with the existing unauthenticated git API) and an HTTP `SubmissionPort` adapter so the browser admin can read/manage submissions in Cut A.

> **Auth note:** the existing `createGitApi` mounts **no** auth middleware (local/self-hosted single-owner). Forms follows the same pattern — the public `/forms/submit` is gated by Turnstile, and the admin CRUD routes are unauthenticated like the git routes. (Adding actor auth is a later, cross-cutting change, not part of basic forms.)

### Task 8: `createFormsApi` Hono sub-app

**Files:**
- Create: `apps/api/src/forms.ts`
- Create: `apps/api/test/forms.test.ts`

**Interfaces:**
- Consumes: `SubmissionService` (Task 7), `SubmissionPort` (Task 1).
- Produces: `createFormsApi(opts: { submit: SubmissionService; submissions: SubmissionPort }): Hono`.
- HTTP contract (used by the Task 9 adapter):
  - `POST /forms/submit` → 200 `{ ok: true, id? }` | 400 `{ ok:false, error:'invalid' }` | 403 `{ ok:false, error:'spam' }` | 500 `{ ok:false, error:'server' }`
  - `POST /forms/submissions` (body `SubmissionInput`) → 201 `Submission`
  - `GET /forms/submissions?formId&read&q&limit&offset` → 200 `{ rows: Submission[]; total: number }`
  - `GET /forms/submissions/:id` → 200 `Submission` | 404 `{ error }`
  - `GET /forms/forms` → 200 `{ forms: FormSummary[] }`
  - `PATCH /forms/submissions/read` (body `{ ids: string[]; read: boolean }`) → 200 `{ ok: true }`
  - `DELETE /forms/submissions` (body `{ ids: string[] }`) → 200 `{ ok: true }`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/test/forms.test.ts
import { describe, it, expect } from 'vitest'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import { createFormsApi } from '../src/forms'

function makeApp(verify = async () => true) {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({ submissions, verifyTurnstile: verify })
  const app = createFormsApi({ submit, submissions })
  return { app, submissions }
}

const post = (app: ReturnType<typeof createFormsApi>, path: string, body: unknown, method = 'POST') =>
  app.fetch(new Request(`http://x${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

describe('createFormsApi', () => {
  it('POST /forms/submit stores a valid submission', async () => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submit', {
      formId: 'contact',
      fields: { email: 'a@x.com', message: 'hi there' },
      turnstileToken: 'tok',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('POST /forms/submit returns 403 on turnstile failure', async () => {
    const { app } = makeApp(async () => false)
    const res = await post(app, '/forms/submit', { formId: 'c', fields: { email: 'a@x.com', message: 'x' }, turnstileToken: 't' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: 'spam' })
  })

  it('POST /forms/submit returns 400 on invalid', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submit', { formId: 'c', fields: { email: 'bad', message: '' }, turnstileToken: 't' })
    expect(res.status).toBe(400)
  })

  it('GET /forms/submissions lists with filters; GET /forms/forms summarizes', async () => {
    const { app, submissions } = makeApp()
    await submissions.saveSubmission({ formId: 'contact', formLabel: 'Contact', fields: { email: 'a@x.com', message: 'one' } })
    await submissions.saveSubmission({ formId: 'apply', formLabel: 'Apply', fields: { email: 'b@x.com', message: 'two' } })
    const list = await (await app.fetch(new Request('http://x/forms/submissions?formId=contact'))).json()
    expect(list.total).toBe(1)
    const forms = await (await app.fetch(new Request('http://x/forms/forms'))).json()
    expect(forms.forms).toEqual([
      { formId: 'apply', formLabel: 'Apply', count: 1 },
      { formId: 'contact', formLabel: 'Contact', count: 1 },
    ])
  })

  it('PATCH read and DELETE work', async () => {
    const { app, submissions } = makeApp()
    const s = await submissions.saveSubmission({ formId: 'c', fields: { email: 'a@x.com', message: 'x' } })
    expect((await post(app, '/forms/submissions/read', { ids: [s.id], read: true }, 'PATCH')).status).toBe(200)
    expect((await submissions.getSubmission(s.id))!.read).toBe(true)
    expect((await post(app, '/forms/submissions', { ids: [s.id] }, 'DELETE')).status).toBe(200)
    expect(await submissions.getSubmission(s.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/api test -- forms`
Expected: FAIL — `../src/forms` not found. (Add `"@setu/db-memory": "workspace:*"` to `apps/api` devDependencies if absent, then `pnpm install`.)

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/forms.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { SubmissionService, SubmissionPort, SubmissionFilter } from '@setu/core'

/** A Hono app exposing the forms submit pipeline + admin CRUD over HTTP. Pure
 *  factory; the caller supplies the service + port (server.ts). No auth — mirrors
 *  createGitApi; the public submit route is gated by Turnstile in the service. */
export function createFormsApi(opts: { submit: SubmissionService; submissions: SubmissionPort }): Hono {
  const { submit, submissions } = opts
  const app = new Hono()
  app.use('*', cors())

  // --- public ---
  app.post('/forms/submit', async (c) => {
    const body = (await c.req.json()) as {
      formId?: string
      formLabel?: string
      fields?: Record<string, string>
      turnstileToken?: string
      honeypot?: string
      source?: { url?: string }
    }
    if (!body.formId || !body.fields || typeof body.turnstileToken !== 'string') {
      return c.json({ ok: false, error: 'invalid' }, 400)
    }
    const source = {
      ...(body.source?.url ? { url: body.source.url } : {}),
      ...(c.req.header('referer') ? { referrer: c.req.header('referer') } : {}),
      ...(c.req.header('user-agent') ? { userAgent: c.req.header('user-agent') } : {}),
    }
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? undefined
    const result = await submit.submit({
      formId: body.formId,
      formLabel: body.formLabel,
      fields: body.fields,
      turnstileToken: body.turnstileToken,
      honeypot: body.honeypot,
      source: Object.keys(source).length ? source : undefined,
      ip,
    })
    if (result.ok) return c.json(result, 200)
    const status = result.error === 'spam' ? 403 : result.error === 'invalid' ? 400 : 500
    return c.json(result, status)
  })

  // --- admin CRUD ---
  app.post('/forms/submissions', async (c) => {
    const body = (await c.req.json()) as Parameters<SubmissionPort['saveSubmission']>[0]
    return c.json(await submissions.saveSubmission(body), 201)
  })

  app.get('/forms/submissions', async (c) => {
    const q = c.req.query()
    const filter: SubmissionFilter = {}
    if (q.formId) filter.formId = q.formId
    if (q.read === 'true') filter.read = true
    if (q.read === 'false') filter.read = false
    if (q.q) filter.q = q.q
    if (q.limit) filter.limit = Number(q.limit)
    if (q.offset) filter.offset = Number(q.offset)
    return c.json(await submissions.listSubmissions(filter))
  })

  app.get('/forms/forms', async (c) => c.json({ forms: await submissions.distinctForms() }))

  app.get('/forms/submissions/:id', async (c) => {
    const row = await submissions.getSubmission(c.req.param('id'))
    return row ? c.json(row) : c.json({ error: 'not found' }, 404)
  })

  app.patch('/forms/submissions/read', async (c) => {
    const { ids, read } = (await c.req.json()) as { ids: string[]; read: boolean }
    await submissions.setRead(ids, read)
    return c.json({ ok: true })
  })

  app.delete('/forms/submissions', async (c) => {
    const { ids } = (await c.req.json()) as { ids: string[] }
    await submissions.deleteSubmissions(ids)
    return c.json({ ok: true })
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/api test -- forms`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/forms.ts apps/api/test/forms.test.ts apps/api/package.json
git commit -m "feat(api): createFormsApi — submit endpoint + admin CRUD"
```

---

### Task 9: HTTP `SubmissionPort` adapter (`@setu/submission-http`)

**Files:**
- Create package: `packages/submission-http/` (`package.json`, `tsconfig.json`, `src/index.ts`)
- Create: `packages/submission-http/test/contract.test.ts`

**Interfaces:**
- Consumes: the HTTP contract from Task 8; `runSubmissionPortContract` (Task 2).
- Produces: `createHttpSubmissionAdapter(opts: { baseUrl: string; fetchImpl?: typeof fetch }): SubmissionPort`.

- [ ] **Step 1: Scaffold package + failing contract test**

`packages/submission-http/package.json`:

```json
{
  "name": "@setu/submission-http",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@setu/api": "workspace:*",
    "@setu/core": "workspace:*",
    "@setu/db-memory": "workspace:*",
    "@setu/db-testing": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

> If `apps/api` has no package `name`, add `"name": "@setu/api"` to `apps/api/package.json` so it can be imported here; otherwise import `createFormsApi` via a relative path is not possible across the workspace — confirm `apps/api/package.json` exposes `createFormsApi` through its `exports`/`main`. If `apps/api` is not importable, instead reconstruct the routes contract in the test with a tiny local Hono app — but prefer importing `createFormsApi`.

`packages/submission-http/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

`packages/submission-http/test/contract.test.ts`:

```typescript
import { runSubmissionPortContract } from '@setu/db-testing'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import { createFormsApi } from '@setu/api'
import { createHttpSubmissionAdapter } from '../src/index'

// Wire the http adapter's fetch straight at the in-memory app (no network).
runSubmissionPortContract(() => {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({ submissions, verifyTurnstile: async () => true })
  const app = createFormsApi({ submit, submissions })
  const fetchImpl = ((input: Request | string | URL, init?: RequestInit) =>
    app.fetch(new Request(typeof input === 'string' || input instanceof URL ? new URL(input, 'http://x').toString() : input, init))) as typeof fetch
  return createHttpSubmissionAdapter({ baseUrl: 'http://x', fetchImpl })
})
```

- [ ] **Step 2: Run install + test (red)**

Run: `pnpm install && pnpm --filter @setu/submission-http test`
Expected: FAIL — adapter not implemented.

- [ ] **Step 3: Implement the adapter**

```typescript
// packages/submission-http/src/index.ts
import type { SubmissionPort, Submission, SubmissionInput, SubmissionFilter, FormSummary } from '@setu/core'

/** A SubmissionPort backed by createFormsApi over HTTP. Mirrors git-http: the
 *  browser admin uses this to read/manage submissions stored by apps/api. */
export function createHttpSubmissionAdapter(opts: { baseUrl: string; fetchImpl?: typeof fetch }): SubmissionPort {
  const base = opts.baseUrl.replace(/\/$/, '')
  const f = opts.fetchImpl ?? fetch
  const json = async (res: Response) => {
    if (!res.ok) throw new Error(`forms api ${res.status}`)
    return res.json()
  }

  return {
    async saveSubmission(input: SubmissionInput) {
      return (await json(
        await f(`${base}/forms/submissions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )) as Submission
    },
    async getSubmission(id) {
      const res = await f(`${base}/forms/submissions/${encodeURIComponent(id)}`)
      if (res.status === 404) return null
      return (await json(res)) as Submission
    },
    async listSubmissions(filter?: SubmissionFilter) {
      const p = new URLSearchParams()
      if (filter?.formId !== undefined) p.set('formId', filter.formId)
      if (filter?.read !== undefined) p.set('read', String(filter.read))
      if (filter?.q) p.set('q', filter.q)
      if (filter?.limit !== undefined) p.set('limit', String(filter.limit))
      if (filter?.offset !== undefined) p.set('offset', String(filter.offset))
      const qs = p.toString()
      return (await json(await f(`${base}/forms/submissions${qs ? `?${qs}` : ''}`))) as {
        rows: Submission[]
        total: number
      }
    },
    async setRead(ids, read) {
      await json(
        await f(`${base}/forms/submissions/read`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, read }),
        }),
      )
    },
    async deleteSubmissions(ids) {
      await json(
        await f(`${base}/forms/submissions`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids }),
        }),
      )
    },
    async distinctForms() {
      return ((await json(await f(`${base}/forms/forms`))) as { forms: FormSummary[] }).forms
    },
    async close() {},
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/submission-http test`
Expected: PASS (full SubmissionPort contract over HTTP).

- [ ] **Step 5: Commit**

```bash
git add packages/submission-http apps/api/package.json
git commit -m "feat(submission-http): HTTP SubmissionPort adapter + contract"
```

---

### Task 10: Wire forms into `apps/api` server + env config

**Files:**
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `createSqliteSubmissionPort` (Task 4), `createSubmissionService`, `createTurnstileVerifier` (Task 6), `createConsoleEmailAdapter` (Task 5), `createFormsApi` (Task 8).
- Env added: `SETU_SUBMISSIONS_DB` (path; default `${dir}/.setu/submissions.db`), `SETU_TURNSTILE_SECRET`, `SETU_FORMS_NOTIFY_TO`, `SETU_FORMS_NOTIFY_FROM`, `SETU_EMAIL_ADAPTER` (`console` default; `resend` added in Phase 5).

- [ ] **Step 1: Add the wiring**

In `apps/api/src/server.ts`, add imports and mount (mirror the existing `app.route('/', ...)` calls):

```typescript
import { createSqliteSubmissionPort } from '@setu/db-sqlite'
import { createSubmissionService, createTurnstileVerifier } from '@setu/core'
import { createConsoleEmailAdapter } from '@setu/email-console'
import { createFormsApi } from './forms'

// ...after existing env consts:
const submissionsDb = process.env.SETU_SUBMISSIONS_DB ?? `${dir}/.setu/submissions.db`
const turnstileSecret = process.env.SETU_TURNSTILE_SECRET ?? ''
const notifyTo = process.env.SETU_FORMS_NOTIFY_TO
const notifyFrom = process.env.SETU_FORMS_NOTIFY_FROM

const submissions = createSqliteSubmissionPort(submissionsDb)
// No secret configured (dev) → accept all (Turnstile disabled). In prod the secret
// MUST be set; an unset secret in production should be treated as misconfiguration.
const verifyTurnstile = turnstileSecret
  ? createTurnstileVerifier(turnstileSecret)
  : async () => true
const email = createConsoleEmailAdapter()
const submit = createSubmissionService({ submissions, verifyTurnstile, email, notifyTo, notifyFrom })

app.route('/', createFormsApi({ submit, submissions }))
```

(Ensure `${dir}/.setu/` exists — the media wiring already writes under `.setu/`; better-sqlite3 creates the file but not parent dirs, so add `import { mkdirSync } from 'node:fs'` and `mkdirSync(\`${dir}/.setu\`, { recursive: true })` before constructing the port if not already guaranteed.)

- [ ] **Step 2: Manual smoke test**

Run the api: `SETU_REPO_DIR=$(pwd)/.content-sandbox/dev pnpm --filter @setu/api dev` (or the root `pnpm dev`). Then:

```bash
curl -s -X POST http://localhost:4444/forms/submit \
  -H 'content-type: application/json' \
  -d '{"formId":"contact","fields":{"email":"a@x.com","message":"hello"},"turnstileToken":"dev"}'
```

Expected: `{"ok":true,"id":"..."}`, an `[email-console]` line in the api log, and:

```bash
curl -s http://localhost:4444/forms/submissions | head -c 400
```

shows the stored row.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -r typecheck`

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): mount forms api with sqlite storage + console email"
```

**Phase 2 checkpoint:** request review. The submit endpoint + admin CRUD + HTTP adapter are done; the backend is reachable over HTTP.

---

## Phase 3 — The `contact` block + site rendering

**Deliverable:** a `contact` block authors can place; on the static site it renders a real form with a Turnstile widget and a React island that validates + submits to `apps/api`. The testable client logic lives in core; the island is thin glue verified by UAT.

### Task 11: contact client logic in core (validate + submit)

**Files:**
- Create: `packages/core/src/submissions/contact-form.ts`
- Modify: `packages/core/src/index.ts` (export)
- Create: `packages/core/test/submissions/contact-form.test.ts`

**Interfaces:**
- Produces:
  - `ContactRequired = { name: boolean; subject: boolean; message: boolean }` (email is always required)
  - `validateContactFields(fields: Record<string,string>, required: ContactRequired): { ok: boolean; errors: Record<string,string> }`
  - `submitContact(opts: { apiBase: string; formId: string; formLabel?: string; fields: Record<string,string>; turnstileToken: string; honeypot?: string; pageUrl?: string; fetchImpl?: typeof fetch }): Promise<SubmitResult>`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/test/submissions/contact-form.test.ts
import { describe, it, expect, vi } from 'vitest'
import { validateContactFields, submitContact } from '../../src/submissions/contact-form'

const req = { name: true, subject: false, message: true }

describe('validateContactFields', () => {
  it('passes a complete valid form', () => {
    const r = validateContactFields({ name: 'Ada', email: 'ada@x.com', message: 'hi' }, req)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual({})
  })
  it('flags a bad email and missing required fields', () => {
    const r = validateContactFields({ name: '', email: 'bad', message: '' }, req)
    expect(r.ok).toBe(false)
    expect(Object.keys(r.errors).sort()).toEqual(['email', 'message', 'name'])
  })
  it('ignores non-required empty fields (subject)', () => {
    const r = validateContactFields({ name: 'A', email: 'a@x.com', subject: '', message: 'hi' }, req)
    expect(r.ok).toBe(true)
  })
})

describe('submitContact', () => {
  it('POSTs to {apiBase}/forms/submit and returns the result', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'x' }), { status: 200 })) as unknown as typeof fetch
    const r = await submitContact({
      apiBase: 'https://api.example.com',
      formId: 'contact',
      fields: { email: 'a@x.com', message: 'hi' },
      turnstileToken: 'tok',
      pageUrl: 'https://site/x',
      fetchImpl,
    })
    expect(r).toEqual({ ok: true, id: 'x' })
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(call[0])).toBe('https://api.example.com/forms/submit')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body).toMatchObject({ formId: 'contact', turnstileToken: 'tok', source: { url: 'https://site/x' } })
  })
  it('maps a non-ok HTTP status to a server error result', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const r = await submitContact({ apiBase: 'https://a', formId: 'c', fields: {}, turnstileToken: 't', fetchImpl })
    expect(r).toEqual({ ok: false, error: 'server' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- contact-form`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/submissions/contact-form.ts
import type { SubmitResult } from './submission-service'

export interface ContactRequired {
  name: boolean
  subject: boolean
  message: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Client-side validation mirroring the server floor. email always required +
 *  format-checked; name/subject/message per the block's `required` config. */
export function validateContactFields(
  fields: Record<string, string>,
  required: ContactRequired,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const val = (k: string) => (fields[k] ?? '').trim()
  if (!EMAIL_RE.test(val('email'))) errors.email = 'Enter a valid email address.'
  if (required.name && val('name') === '') errors.name = 'Required.'
  if (required.subject && val('subject') === '') errors.subject = 'Required.'
  if (required.message && val('message') === '') errors.message = 'Required.'
  return { ok: Object.keys(errors).length === 0, errors }
}

/** POST a contact submission to the forms API. Network/parse failures map to a
 *  server error result so the island can show a generic message. */
export async function submitContact(opts: {
  apiBase: string
  formId: string
  formLabel?: string
  fields: Record<string, string>
  turnstileToken: string
  honeypot?: string
  pageUrl?: string
  fetchImpl?: typeof fetch
}): Promise<SubmitResult> {
  const f = opts.fetchImpl ?? fetch
  try {
    const res = await f(`${opts.apiBase.replace(/\/$/, '')}/forms/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        formId: opts.formId,
        formLabel: opts.formLabel,
        fields: opts.fields,
        turnstileToken: opts.turnstileToken,
        honeypot: opts.honeypot,
        source: opts.pageUrl ? { url: opts.pageUrl } : undefined,
      }),
    })
    if (!res.ok && res.status >= 500) return { ok: false, error: 'server' }
    return (await res.json()) as SubmitResult
  } catch {
    return { ok: false, error: 'server' }
  }
}
```

Add to `packages/core/src/index.ts`:

```typescript
export { validateContactFields, submitContact } from './submissions/contact-form'
export type { ContactRequired } from './submissions/contact-form'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- contact-form`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/submissions/contact-form.ts packages/core/src/index.ts packages/core/test/submissions/contact-form.test.ts
git commit -m "feat(core): contact form client logic (validate + submit)"
```

---

### Task 12: `ContactForm` React island + styles (`@setu/blocks`)

**Files:**
- Create: `packages/blocks/src/contact/ContactForm.tsx`
- Create: `packages/blocks/src/contact/contact.css`
- Modify: `packages/blocks/package.json` (add `@setu/blocks/ContactForm` + `@setu/blocks/contact.css` to `exports`; add `"@setu/core": "workspace:*"` and React deps if not present)

**Interfaces:**
- Consumes: `validateContactFields`, `submitContact`, `ContactRequired` (Task 11).
- Produces: default-exported `ContactForm` React component with props
  `{ formId: string; formLabel?: string; apiBase: string; subject?: boolean; required: ContactRequired; labels?: Record<string,string>; placeholders?: Record<string,string>; successMessage: string }`.

> **Test strategy:** the network + validation logic is already unit-tested in core (Task 11). This island is thin glue around the global Turnstile widget; it is verified by the Task 13 UAT step, not a unit test (rendering depends on the external Turnstile script + `client:load` hydration).

- [ ] **Step 1: Implement the component**

```tsx
// packages/blocks/src/contact/ContactForm.tsx
import { useState, type FormEvent } from 'react'
import { validateContactFields, submitContact, type ContactRequired } from '@setu/core'
import './contact.css'

export interface ContactFormProps {
  formId: string
  formLabel?: string
  apiBase: string
  subject?: boolean
  required: ContactRequired
  labels?: Record<string, string>
  placeholders?: Record<string, string>
  successMessage: string
}

export default function ContactForm(props: ContactFormProps) {
  const { formId, formLabel, apiBase, subject = false, required, labels = {}, placeholders = {}, successMessage } = props
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const fields: Record<string, string> = {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      message: String(fd.get('message') ?? ''),
    }
    if (subject) fields.subject = String(fd.get('subject') ?? '')

    const v = validateContactFields(fields, required)
    setErrors(v.errors)
    if (!v.ok) return

    const token = String(fd.get('cf-turnstile-response') ?? '')
    if (token === '') {
      setStatus('error')
      return
    }

    setStatus('sending')
    const result = await submitContact({
      apiBase,
      formId,
      formLabel,
      fields,
      turnstileToken: token,
      honeypot: String(fd.get('company') ?? ''), // honeypot field
      pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    if (result.ok) {
      setStatus('done')
      form.reset()
    } else {
      setStatus('error')
    }
  }

  if (status === 'done') {
    return <p className="setu-contact__success" role="status">{successMessage}</p>
  }

  const field = (name: 'name' | 'email' | 'subject' | 'message', type: 'text' | 'email' | 'textarea') => (
    <div className="setu-contact__row">
      <label htmlFor={`setu-${formId}-${name}`}>{labels[name] ?? name[0]!.toUpperCase() + name.slice(1)}</label>
      {type === 'textarea' ? (
        <textarea id={`setu-${formId}-${name}`} name={name} placeholder={placeholders[name] ?? ''} rows={5} />
      ) : (
        <input id={`setu-${formId}-${name}`} name={name} type={type} placeholder={placeholders[name] ?? ''} />
      )}
      {errors[name] && <span className="setu-contact__error">{errors[name]}</span>}
    </div>
  )

  return (
    <form className="setu-contact" onSubmit={onSubmit} noValidate>
      {field('name', 'text')}
      {field('email', 'email')}
      {subject && field('subject', 'text')}
      {field('message', 'textarea')}
      {/* Honeypot: visually hidden, bots fill it. */}
      <div className="setu-contact__hp" aria-hidden="true">
        <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {/* Turnstile renders here (script injected by the .astro); it adds a hidden
          input named cf-turnstile-response inside this form. */}
      <div className="cf-turnstile" data-sitekey={(globalThis as { SETU_TURNSTILE_SITE_KEY?: string }).SETU_TURNSTILE_SITE_KEY} />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>
      {status === 'error' && <p className="setu-contact__error" role="alert">Something went wrong. Please try again.</p>}
    </form>
  )
}
```

> The `data-sitekey` reads a global set by the `.astro` (Task 13) via an inline script, because the site key is a build-time site value, not a per-instance author prop. (Alternative: pass `siteKey` as a prop — but Turnstile auto-render needs the attribute present at hydration; a global keeps the island prop-set stable. Either is acceptable; the UAT step verifies the widget renders.)

- [ ] **Step 2: Styles**

```css
/* packages/blocks/src/contact/contact.css */
.setu-contact { display: grid; gap: 1rem; max-width: 32rem; }
.setu-contact__row { display: grid; gap: 0.35rem; }
.setu-contact label { font-weight: 600; font-size: 0.9rem; }
.setu-contact input, .setu-contact textarea {
  padding: 0.6rem 0.7rem; border: 1px solid var(--border, #d4d4d8); border-radius: 0.5rem; font: inherit;
}
.setu-contact button {
  justify-self: start; padding: 0.6rem 1.1rem; border: 0; border-radius: 0.5rem;
  background: var(--accent, #18181b); color: #fff; font: inherit; cursor: pointer;
}
.setu-contact button:disabled { opacity: 0.6; cursor: default; }
.setu-contact__error { color: #b91c1c; font-size: 0.85rem; }
.setu-contact__success { padding: 1rem; border: 1px solid #16a34a; border-radius: 0.5rem; color: #166534; }
.setu-contact__hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
```

- [ ] **Step 3: Add package exports**

In `packages/blocks/package.json`, extend `exports` (mirror the existing `./callout.css` / component entries):

```json
"./ContactForm": "./src/contact/ContactForm.tsx",
"./contact.css": "./src/contact/contact.css"
```

Add `"@setu/core": "workspace:*"` to dependencies if not already present, then `pnpm install`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @setu/blocks typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/blocks/src/contact packages/blocks/package.json
git commit -m "feat(blocks): ContactForm React island + styles"
```

---

### Task 13: `contact` block folder + site env wiring + UAT

**Files:**
- Create: `blocks/contact/block.ts`
- Create: `blocks/contact/contact.astro`
- Modify: `apps/site/.env.example` (document `PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_SETU_API_BASE`) — create if absent
- (Regenerates `apps/site/markdoc.blocks.generated.mjs` via `scripts/gen-blocks.mjs`)

**Interfaces:**
- Consumes: `defineBlock` (`@setu/core`), `ContactForm` (`@setu/blocks/ContactForm`).

- [ ] **Step 1: Block contract**

```typescript
// blocks/contact/block.ts
import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    formId: z.string(),
    formLabel: z.string().optional(),
    subject: z.boolean().default(false),
    nameRequired: z.boolean().default(true),
    subjectRequired: z.boolean().default(false),
    messageRequired: z.boolean().default(true),
    successMessage: z.string().default('Thanks — your message has been sent.'),
  }),
  editor: {
    label: 'Contact form',
    icon: 'mail',
    group: 'widget',
    keywords: ['form', 'contact', 'email', 'enquiry', 'message'],
  },
})
```

- [ ] **Step 2: Astro render**

```astro
---
// blocks/contact/contact.astro
import ContactForm from '@setu/blocks/ContactForm'
import '@setu/blocks/contact.css'

const {
  formId,
  formLabel,
  subject = false,
  nameRequired = true,
  subjectRequired = false,
  messageRequired = true,
  successMessage = 'Thanks — your message has been sent.',
} = Astro.props

const siteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? ''
const apiBase = import.meta.env.PUBLIC_SETU_API_BASE ?? 'http://localhost:4444'
const required = { name: nameRequired, subject: subjectRequired, message: messageRequired }
---

<!-- Expose the build-time site key to the island + Turnstile auto-render. -->
<script is:inline define:vars={{ siteKey }}>
  window.SETU_TURNSTILE_SITE_KEY = siteKey
</script>
<ContactForm
  client:load
  formId={formId}
  formLabel={formLabel}
  apiBase={apiBase}
  subject={subject}
  required={required}
  successMessage={successMessage}
/>
<script is:inline src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

- [ ] **Step 3: Document env**

Create/append `apps/site/.env.example`:

```
# Cloudflare Turnstile public site key (rendered in the contact form widget)
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
# Base URL of the Setu forms API (apps/api). Dev default: http://localhost:4444
PUBLIC_SETU_API_BASE=http://localhost:4444
```

(`1x00000000000000000000AA` is Cloudflare's documented **always-passes test** site key — pair with the test secret `1x0000000000000000000000000000000AA` on the api for local UAT.)

- [ ] **Step 4: Regenerate the block registry**

Run: `pnpm --filter @setu/site exec node ../../scripts/gen-blocks.mjs` (or just start `pnpm dev`, whose `predev` runs it).
Expected: console shows `gen-blocks: N block(s): ..., contact` and `apps/site/markdoc.blocks.generated.mjs` now includes a `contact:` entry.

- [ ] **Step 5: UAT — render + submit end-to-end**

1. Add a `{% contact formId="contact" formLabel="Contact" subject=true %}` tag to a content page in the dev sandbox (e.g. `.content-sandbox/dev/content/page/en/contact.mdoc`).
2. Start the stack with test keys:
   ```
   PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
   SETU_TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
   pnpm dev
   ```
3. Visit the page on the site (`http://localhost:4321/page/contact`). Expected: the form renders, the Turnstile widget shows (test key auto-passes), and submitting shows the success message.
4. Confirm the row landed: `curl -s http://localhost:4444/forms/submissions | head -c 400`.

- [ ] **Step 6: Commit**

```bash
git add blocks/contact apps/site/.env.example apps/site/markdoc.blocks.generated.mjs
git commit -m "feat(blocks): contact block folder + site Turnstile/api wiring"
```

**Phase 3 checkpoint:** request review. A visitor can now submit the form on the static site and it persists via apps/api.

---

## Phase 4 — Admin inbox (`/forms`)

**Deliverable:** the `/forms` placeholder becomes a real inbox — list (newest-first), filter by form, unread badge, search, pagination, detail view, mark read/unread, delete, bulk actions, and CSV export.

### Task 14: wire `SubmissionPort` into the admin service bundle

**Files:**
- Modify: `apps/admin/src/data/store.tsx` (add `submissions` to `Services` + `servicesFor`)
- Modify: the admin bootstrap (where the API base + `git-http` adapter are constructed in API mode) to build the HTTP submission adapter from the same base.

**Interfaces:**
- Consumes: `createHttpSubmissionAdapter` (Task 9), `createMemorySubmissionPort` (Task 3), `SubmissionPort`.
- Produces: `Services.submissions: SubmissionPort`.

- [ ] **Step 1: Extend the Services bundle**

In `apps/admin/src/data/store.tsx`:

```typescript
import type { SubmissionPort } from '@setu/core'
import { createMemorySubmissionPort } from '@setu/db-memory'

// add to the Services interface:
export interface Services {
  // ...existing fields...
  submissions: SubmissionPort
}

// update servicesFor to accept + return it (default to memory for the demo topology):
export function servicesFor(
  data: DataPort,
  git: GitPort,
  index: IndexPort = createMemoryIndexPort(),
  mediaIndex: MediaIndexService = createMediaIndexService({ mediaIndex: createMemoryMediaIndexPort(), fetchRaw: async () => [] }),
  submissions: SubmissionPort = createMemorySubmissionPort(),
): Services {
  const read = createReadService({ data, git, knownBlockTags: registry.knownBlockTags })
  return {
    // ...existing fields...
    submissions,
  }
}
```

- [ ] **Step 2: Build the HTTP adapter in API mode**

Locate where the API base URL is resolved and the HTTP git adapter is created (grep the admin for `createHttpGitAdapter` / `git-http` / the API base env, e.g. `import.meta.env.VITE_SETU_API_BASE`). Alongside it, construct:

```typescript
import { createHttpSubmissionAdapter } from '@setu/submission-http'
// where apiBase is the resolved API URL used for git-http:
const submissions = createHttpSubmissionAdapter({ baseUrl: apiBase })
// pass it through to servicesFor(..., submissions)
```

Add `"@setu/submission-http": "workspace:*"` to `apps/admin/package.json` dependencies, then `pnpm install`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/data/store.tsx apps/admin/package.json
# plus the bootstrap file you modified
git commit -m "feat(admin): add SubmissionPort to the service bundle (http in API mode)"
```

---

### Task 15: CSV export util (pure, TDD)

**Files:**
- Create: `packages/core/src/submissions/csv.ts`
- Modify: `packages/core/src/index.ts` (export)
- Create: `packages/core/test/submissions/csv.test.ts`

**Interfaces:**
- Produces: `submissionsToCsv(rows: Submission[]): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/submissions/csv.test.ts
import { describe, it, expect } from 'vitest'
import { submissionsToCsv } from '../../src/submissions/csv'
import type { Submission } from '../../src/submissions/types'

const row = (over: Partial<Submission>): Submission => ({
  id: 'id1',
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hi' },
  createdAt: 0,
  read: false,
  ...over,
})

describe('submissionsToCsv', () => {
  it('emits a header + one row per submission with field columns', () => {
    const csv = submissionsToCsv([row({})])
    const [header, line] = csv.trim().split('\n')
    expect(header).toContain('id')
    expect(header).toContain('email')
    expect(line).toContain('ada@x.com')
  })

  it('escapes commas, quotes, and newlines', () => {
    const csv = submissionsToCsv([row({ fields: { name: 'a,b', email: 'x@y.com', message: 'he said "hi"\nbye' } })])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"he said ""hi""\nbye"')
  })

  it('returns just a header for no rows', () => {
    expect(submissionsToCsv([]).trim().split('\n')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- submissions/csv`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/submissions/csv.ts
import type { Submission } from './types'

const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Serialize submissions to CSV. Fixed metadata columns + the union of field keys
 *  (sorted). Date is ISO. Excel-safe quoting. */
export function submissionsToCsv(rows: Submission[]): string {
  const fieldKeys = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))].sort()
  const header = ['id', 'date', 'formId', 'formLabel', 'read', ...fieldKeys]
  const lines = rows.map((r) =>
    [
      r.id,
      new Date(r.createdAt).toISOString(),
      r.formId,
      r.formLabel ?? '',
      String(r.read),
      ...fieldKeys.map((k) => r.fields[k] ?? ''),
    ]
      .map((v) => esc(String(v)))
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}
```

Add to `packages/core/src/index.ts`:

```typescript
export { submissionsToCsv } from './submissions/csv'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- submissions/csv`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/submissions/csv.ts packages/core/src/index.ts packages/core/test/submissions/csv.test.ts
git commit -m "feat(core): submissionsToCsv export util"
```

---

### Task 16: `FormsInbox` screen (list/filter/search/detail/triage/bulk/export)

**Files:**
- Create: `apps/admin/src/screens/FormsInbox.tsx`
- Modify: `apps/admin/src/app.tsx` (route `/forms` → `<FormsInbox />` instead of `<Placeholder title="Forms" />`)

**Interfaces:**
- Consumes: `Services.submissions` (Task 14) via `useServices`; `useNotify`; `submissionsToCsv` (Task 15); `Submission`/`FormSummary` types.

> **Test strategy:** the data/util logic (port + CSV) is unit-tested. The screen itself is verified by the UAT step (admin screens in this repo are integration-verified, mirroring the existing `ContentList`). Mirror `ContentList` patterns: `useSearchParams` URL state, debounced search, `Pager`, selection `Set`, `useNotify`.

- [ ] **Step 1: Implement the screen**

```tsx
// apps/admin/src/screens/FormsInbox.tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Submission, FormSummary } from '@setu/core'
import { submissionsToCsv } from '@setu/core'
import { useServices } from '../data/store'
import { useNotify } from '../ui/notify'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Pager } from './content-list/Pager'

const PAGE_SIZE = 20
const ALL = '__all__'

export function FormsInbox() {
  const { submissions } = useServices()
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Submission[] | null>(null)
  const [total, setTotal] = useState(0)
  const [forms, setForms] = useState<FormSummary[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<Submission | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const form = params.get('form') ?? ''
  const readParam = params.get('read') ?? '' // '', 'true', 'false'
  const q = params.get('q') ?? ''

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  // debounced search
  const [search, setSearch] = useState(q)
  useEffect(() => setSearch(q), [q])
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) setParam('q', search)
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [form, readParam, q])

  useEffect(() => {
    void submissions.distinctForms().then(setForms)
  }, [submissions, refreshKey])

  useEffect(() => {
    let live = true
    void (async () => {
      const filter: Parameters<typeof submissions.listSubmissions>[0] = {
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }
      if (form) filter.formId = form
      if (readParam === 'true') filter.read = true
      if (readParam === 'false') filter.read = false
      if (q) filter.q = q
      const r = await submissions.listSubmissions(filter)
      if (live) {
        setRows(r.rows)
        setTotal(r.total)
      }
    })()
    return () => {
      live = false
    }
  }, [submissions, page, form, readParam, q, refreshKey])

  const refresh = () => setRefreshKey((k) => k + 1)

  const openDetail = async (s: Submission) => {
    setActive(s)
    if (!s.read) {
      await submissions.setRead([s.id], true)
      refresh()
    }
  }

  const toggleRead = async (s: Submission) => {
    await submissions.setRead([s.id], !s.read)
    notify.success(s.read ? 'Marked unread' : 'Marked read')
    refresh()
  }

  const removeMany = async (ids: string[]) => {
    if (ids.length === 0) return
    await submissions.deleteSubmissions(ids)
    notify.success(`Deleted ${ids.length} submission${ids.length === 1 ? '' : 's'}`)
    setSelected(new Set())
    if (active && ids.includes(active.id)) setActive(null)
    refresh()
  }

  const exportCsv = async () => {
    // Export the full filtered set, not just the current page.
    const filter: Parameters<typeof submissions.listSubmissions>[0] = { limit: 100000 }
    if (form) filter.formId = form
    if (readParam === 'true') filter.read = true
    if (readParam === 'false') filter.read = false
    if (q) filter.q = q
    const all = await submissions.listSubmissions(filter)
    const blob = new Blob([submissionsToCsv(all.rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'submissions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const pageKeys = (rows ?? []).map((r) => r.id)
  const allSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pageKeys))
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <>
      <PageHeader
        title="Forms"
        count={rows !== null ? total : undefined}
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={total === 0}>Export CSV</Button>}
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Input
            className="min-w-48 flex-1"
            placeholder="Search submissions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={form || ALL} onValueChange={(v) => setParam('form', v === ALL ? '' : v)}>
            <SelectTrigger size="sm" className="w-44"><SelectValue placeholder="All forms" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All forms</SelectItem>
              {forms.map((f) => (
                <SelectItem key={f.formId} value={f.formId}>{(f.formLabel ?? f.formId) + ` (${f.count})`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={readParam || ALL} onValueChange={(v) => setParam('read', v === ALL ? '' : v)}>
            <SelectTrigger size="sm" className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              <SelectItem value="false">Unread</SelectItem>
              <SelectItem value="true">Read</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions{form || readParam || q ? ' match your filters' : ' yet'}.</p>
        ) : (
          <>
            {selected.size > 0 && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <span className="text-sm font-medium">{selected.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => void submissions.setRead([...selected], true).then(() => { notify.success('Marked read'); setSelected(new Set()); refresh() })}>Mark read</Button>
                <Button size="sm" variant="outline" onClick={() => void submissions.setRead([...selected], false).then(() => { notify.success('Marked unread'); setSelected(new Set()); refresh() })}>Mark unread</Button>
                <Button size="sm" variant="destructive" onClick={() => void removeMany([...selected])}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}
            <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select page" /></th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">Form</th>
                    <th className="px-3 py-2">Received</th>
                    <th className="w-24 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className={`border-b last:border-0 ${s.read ? '' : 'font-medium'}`}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleRow(s.id)} aria-label="Select submission" /></td>
                      <td className="cursor-pointer px-3 py-2" onClick={() => void openDetail(s)}>
                        {!s.read && <Badge variant="secondary" className="mr-2">New</Badge>}
                        {s.fields.email ?? s.fields.name ?? '(no email)'}
                      </td>
                      <td className="px-3 py-2">{s.formLabel ?? s.formId}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" onClick={() => void toggleRead(s)}>{s.read ? 'Unread' : 'Read'}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > 0 && <Pager from={from} to={to} total={total} page={page} onPage={setPage} />}
            </div>
          </>
        )}

        {active && (
          <div className="mt-4 rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">{active.formLabel ?? active.formId}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void toggleRead(active)}>{active.read ? 'Mark unread' : 'Mark read'}</Button>
                <Button size="sm" variant="destructive" onClick={() => void removeMany([active.id])}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setActive(null)}>Close</Button>
              </div>
            </div>
            <dl className="grid gap-2">
              {Object.entries(active.fields).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="whitespace-pre-wrap">{v}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[8rem_1fr] gap-2">
                <dt className="text-muted-foreground">Received</dt>
                <dd>{new Date(active.createdAt).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        )}
      </PageBody>
    </>
  )
}
```

> If any imported UI primitive path differs (e.g. `../ui/input` vs `../ui/Input`), match the casing/path used by `ContentList.tsx` and `ListToolbar.tsx` exactly.

- [ ] **Step 2: Route it**

In `apps/admin/src/app.tsx`, replace the forms route:

```typescript
import { FormsInbox } from './screens/FormsInbox'
// ...
<Route path="/forms" element={<FormsInbox />} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 4: UAT**

Start `pnpm dev`, submit a couple of forms (via the site contact page from Phase 3), then open the admin `/forms`. Expected: submissions list newest-first with a "New" badge; filtering by form + read state works; search filters; clicking a row opens detail and clears the badge; mark read/unread, delete, bulk select + bulk delete/mark, and Export CSV all work.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens/FormsInbox.tsx apps/admin/src/app.tsx
git commit -m "feat(admin): forms submissions inbox (list/filter/search/detail/triage/bulk/export)"
```

**Phase 4 checkpoint:** request review. Forms is a complete CMS surface end-to-end.

---

## Phase 5 — Real email: React Email template + Resend adapter

**Deliverable:** notifications send real HTML email via Resend, with the body rendered by React Email; the adapter is selected by env (`console` default → `resend`). Console remains the zero-config dev default.

### Task 17: `@setu/email-templates` — React Email notification

**Files:**
- Create package: `packages/email-templates/` (`package.json`, `tsconfig.json`, `src/SubmissionNotification.tsx`, `src/index.ts`, `test/render.test.ts`)

**Interfaces:**
- Consumes: `Submission`, `NotificationContent` (`@setu/core`).
- Produces: `renderSubmissionEmail(submission: Submission): Promise<NotificationContent>`.

- [ ] **Step 1: Scaffold package**

`packages/email-templates/package.json`:

```json
{
  "name": "@setu/email-templates",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@setu/core": "workspace:*",
    "@react-email/components": "^0.0.32",
    "@react-email/render": "^1.0.5",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

> Confirm latest compatible versions with context7/npm at implementation time (React 19-compatible `@react-email/*`); pin what installs cleanly. `tsconfig.json` must enable JSX: extend base and add `"jsx": "react-jsx"`:

`packages/email-templates/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [], "jsx": "react-jsx" }, "include": ["src", "test"] }
```

- [ ] **Step 2: Write the failing test**

```tsx
// packages/email-templates/test/render.test.ts
import { describe, it, expect } from 'vitest'
import { renderSubmissionEmail } from '../src/index'
import type { Submission } from '@setu/core'

const sub: Submission = {
  id: 'x',
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hello world' },
  createdAt: 0,
  read: false,
}

describe('renderSubmissionEmail', () => {
  it('renders subject + html containing the field values', async () => {
    const out = await renderSubmissionEmail(sub)
    expect(out.subject).toContain('Contact')
    expect(out.html).toContain('ada@x.com')
    expect(out.html).toContain('hello world')
    expect(out.text).toBeTypeOf('string')
  })
})
```

- [ ] **Step 3: Install + run (red)**

Run: `pnpm install && pnpm --filter @setu/email-templates test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```tsx
// packages/email-templates/src/SubmissionNotification.tsx
import { Html, Head, Body, Container, Heading, Text, Section, Row, Column } from '@react-email/components'
import type { Submission } from '@setu/core'

export function SubmissionNotification({ submission }: { submission: Submission }) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f4f4f5' }}>
        <Container style={{ background: '#fff', padding: '24px', borderRadius: '8px' }}>
          <Heading as="h2">New submission: {submission.formLabel ?? submission.formId}</Heading>
          <Section>
            {Object.entries(submission.fields).map(([k, v]) => (
              <Row key={k}>
                <Column style={{ width: '120px', color: '#71717a', verticalAlign: 'top' }}>
                  <Text style={{ margin: '4px 0' }}>{k}</Text>
                </Column>
                <Column>
                  <Text style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{v}</Text>
                </Column>
              </Row>
            ))}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
```

```tsx
// packages/email-templates/src/index.ts
import { render } from '@react-email/render'
import type { Submission, NotificationContent } from '@setu/core'
import { SubmissionNotification } from './SubmissionNotification'

/** Render the submission-notification email to HTML + plaintext. */
export async function renderSubmissionEmail(submission: Submission): Promise<NotificationContent> {
  const el = <SubmissionNotification submission={submission} />
  const html = await render(el)
  const text = await render(el, { plainText: true })
  return {
    subject: `New submission: ${submission.formLabel ?? submission.formId}`,
    html,
    text,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/email-templates test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/email-templates
git commit -m "feat(email-templates): React Email submission notification + render"
```

---

### Task 18: `@setu/email-resend` adapter

**Files:**
- Create package: `packages/email-resend/` (`package.json`, `tsconfig.json`, `src/index.ts`, `test/resend.test.ts`)

**Interfaces:**
- Consumes: `EmailPort`, `EmailMessage` (`@setu/core`).
- Produces: `createResendEmailAdapter(opts: { apiKey: string; client?: ResendLike }): EmailPort` where `ResendLike = { emails: { send(args): Promise<unknown> } }`.

- [ ] **Step 1: Scaffold + failing test**

`packages/email-resend/package.json`:

```json
{
  "name": "@setu/email-resend",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*", "resend": "^4.0.0" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

> Verify the latest `resend` version with context7/npm at implementation time.

`packages/email-resend/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

```typescript
// packages/email-resend/test/resend.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createResendEmailAdapter } from '../src/index'

describe('resend email adapter', () => {
  it('maps EmailMessage to resend.emails.send', async () => {
    const send = vi.fn(async () => ({ id: 'r1' }))
    const adapter = createResendEmailAdapter({ apiKey: 'k', client: { emails: { send } } })
    await adapter.send({ to: 'a@x.com', from: 'site@x.com', subject: 'Hi', html: '<p>x</p>', text: 'x' })
    expect(send).toHaveBeenCalledWith({ to: 'a@x.com', from: 'site@x.com', subject: 'Hi', html: '<p>x</p>', text: 'x' })
  })

  it('throws when resend returns an error shape', async () => {
    const send = vi.fn(async () => ({ error: { message: 'bad key' } }))
    const adapter = createResendEmailAdapter({ apiKey: 'k', client: { emails: { send } } })
    await expect(adapter.send({ to: 'a@x.com', from: 's@x.com', subject: 'h', html: 'x' })).rejects.toThrow('bad key')
  })
})
```

- [ ] **Step 2: Install + run (red)**

Run: `pnpm install && pnpm --filter @setu/email-resend test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/email-resend/src/index.ts
import { Resend } from 'resend'
import type { EmailPort, EmailMessage } from '@setu/core'

interface ResendLike {
  emails: { send(args: EmailMessage): Promise<{ error?: { message: string } | null } | unknown> }
}

/** Resend-backed EmailPort. Works in Node + edge (the SDK is fetch-based). */
export function createResendEmailAdapter(opts: { apiKey: string; client?: ResendLike }): EmailPort {
  const client: ResendLike = opts.client ?? (new Resend(opts.apiKey) as unknown as ResendLike)
  return {
    async send(msg: EmailMessage) {
      const res = (await client.emails.send(msg)) as { error?: { message: string } | null }
      if (res && res.error) throw new Error(res.error.message)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/email-resend test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/email-resend
git commit -m "feat(email-resend): Resend EmailPort adapter"
```

---

### Task 19: select adapter + template in `apps/api`

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json` (add `@setu/email-resend`, `@setu/email-templates` deps)

**Interfaces:**
- Consumes: `createResendEmailAdapter` (Task 18), `renderSubmissionEmail` (Task 17), `createConsoleEmailAdapter` (Task 5).
- Env added: `SETU_EMAIL_ADAPTER` (`console` | `resend`, default `console`), `RESEND_API_KEY`.

- [ ] **Step 1: Wire adapter selection + the React Email renderer**

Replace the Phase 2 `const email = createConsoleEmailAdapter()` line in `apps/api/src/server.ts`:

```typescript
import { createResendEmailAdapter } from '@setu/email-resend'
import { renderSubmissionEmail } from '@setu/email-templates'

const emailAdapter = process.env.SETU_EMAIL_ADAPTER ?? 'console'
const email =
  emailAdapter === 'resend'
    ? createResendEmailAdapter({ apiKey: process.env.RESEND_API_KEY ?? '' })
    : createConsoleEmailAdapter()

const submit = createSubmissionService({
  submissions,
  verifyTurnstile,
  email,
  notifyTo,
  notifyFrom,
  renderNotification: renderSubmissionEmail, // React Email HTML/text
})
```

Add to `apps/api/package.json` dependencies: `"@setu/email-resend": "workspace:*"`, `"@setu/email-templates": "workspace:*"`; then `pnpm install`.

- [ ] **Step 2: Verify + manual smoke**

Run: `pnpm -r typecheck` (Expected: PASS).
Console path (default): submit a form (Phase 2/3 smoke) and confirm the logged email body is now the rendered React Email HTML.
Resend path (optional, needs a key): `SETU_EMAIL_ADAPTER=resend RESEND_API_KEY=... SETU_FORMS_NOTIFY_TO=you@x.com SETU_FORMS_NOTIFY_FROM=onboarding@resend.dev pnpm dev`, submit, confirm the email arrives.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/server.ts apps/api/package.json
git commit -m "feat(api): select email adapter by env + React Email notification body"
```

**Phase 5 checkpoint:** final whole-branch review (`superpowers:requesting-code-review` on opus), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- Scope (contact block + inbox + email + Turnstile, pro deferred) → Tasks 13/16/19/6. ✅
- `contact` block fixed fields + light props → Task 13. ✅
- Spam prevention (Turnstile + honeypot, rejected pre-store, no spam status) → Tasks 6/7/12. ✅
- `SubmissionPort` (sqlite now, DB-not-Git, edge-later seam) → Tasks 1–4. ✅
- Submission handler (honeypot→turnstile→validate→persist→best-effort notify) → Task 7. ✅
- `EmailPort` pluggable + Resend default + console dev + React Email → Tasks 5/17/18/19. ✅
- Admin inbox (list/filter-by-form/unread/detail/delete/CSV/search/bulk, no spam) → Tasks 15/16. ✅
- v1 topology dev+self-hosted; edge behind seams → Tasks 9/10, edge explicitly out of scope. ✅
- HTTP read path for the browser admin (Cut A) → Task 9 (`submission-http`). ✅

**2. Placeholder scan:** No TBD/TODO in code steps; every code step shows complete code. Integration touch-points that depend on un-captured bootstrap code (Task 14 Step 2) include a concrete grep target + the exact call to add — not a vague instruction.

**3. Type consistency:** `SubmissionPort`/`Submission`/`SubmissionInput`/`SubmissionFilter`/`FormSummary` names are consistent across Tasks 1–4, 8, 9, 15, 16. `SubmitResult`/`SubmitInput`/`NotificationContent` consistent across Tasks 7, 8, 11. `renderNotification` is async-tolerant (Task 7) to match `renderSubmissionEmail` (Task 17). `EmailPort.send(EmailMessage)` consistent across Tasks 5, 18, 19.

**Open questions resolved:** O1 → island-only for v1 (no-JS fallback deferred; noted in Task 12). O2 → Turnstile site key + API base via `apps/site` `PUBLIC_*` env at build (Task 13); secret via `apps/api` `SETU_TURNSTILE_SECRET` (Task 10). O3 → `crypto.randomUUID()` in the adapter (Tasks 3, 4).

