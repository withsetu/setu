# Read / Fork-from-Git Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the content half of the round-trip — a read service that materializes an editable draft for an entry, forking from published Git content (`markdocToTiptap`) when no live draft exists.

**Architecture:** A new pure `src/read/` module in `@saytu/core`: `createReadService({ data, git }).loadForEdit(ref)` returns the live DB draft, else reads the published `.mdoc` via `GitPort` → `markdocToTiptap` → persists a draft (`baseSha = HEAD`) via `DataPort`, else reports absent. No UI, no Node — edge-portable. Kept separate from the authoring/lock service (#4) so that stays pure.

**Tech Stack:** TypeScript (strict), Vitest. Consumes `markdocToTiptap`, `contentPath`, `DataPort`, `GitPort` — all already exported from `@saytu/core`.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-read-fork-design.md`

---

## File Structure

```
packages/core/src/read/
├── types.ts          # LoadResult, ReadDeps, ReadService
└── read-service.ts   # createReadService(deps): { loadForEdit }
packages/core/src/index.ts        # + re-export the read surface
packages/core/tsconfig.edge.json  # + "src/read" in include
packages/core/test/read/read-service.test.ts
```

---

### Task 1: `createReadService` (read / fork-from-Git)

**Files:**
- Create: `packages/core/src/read/types.ts`
- Create: `packages/core/src/read/read-service.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tsconfig.edge.json`
- Test: `packages/core/test/read/read-service.test.ts`

- [ ] **Step 1: Create the types**

Create `packages/core/src/read/types.ts`:

```ts
import type { Draft, EntryRef } from '../data/types'
import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'

/** Result of loading an entry for editing. */
export type LoadResult =
  /** An existing live DB draft (unpublished work-in-progress) was found. */
  | { source: 'draft'; draft: Draft }
  /** No draft existed; one was freshly materialized from published Git content. */
  | { source: 'forked'; draft: Draft }
  /** No draft and no published file — the entry does not exist. */
  | { source: 'absent' }

export interface ReadDeps {
  data: DataPort
  git: GitPort
}

export interface ReadService {
  /** Return the editable draft for `ref`: the live draft if present, else a draft
   *  forked from published Git content (persisted, baseSha = HEAD), else absent. */
  loadForEdit(ref: EntryRef): Promise<LoadResult>
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/test/read/read-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createReadService, tiptapToMarkdoc, markdocToTiptap, contentPath } from '../../src/index'
import type { DataPort, Draft, EntryRef, GitPort, Lock, TiptapDoc } from '../../src/index'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`
const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const author = { name: 'E', email: 'e@x.com' }

/** Minimal in-memory DataPort (full interface). */
function fakeData(): DataPort {
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

/** In-memory GitPort (files Map + incrementing sha + head). */
function fakeGit(): GitPort {
  const files = new Map<string, string>()
  let counter = 0
  let head: string | null = null
  return {
    async headSha() {
      return head
    },
    async readFile(path) {
      return head === null ? null : files.get(path) ?? null
    },
    async commitFile(input) {
      files.set(input.path, input.content)
      head = `gitsha${++counter}`
      return { sha: head }
    },
  }
}

describe('createReadService.loadForEdit', () => {
  let data: DataPort
  let git: GitPort
  const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'hello' }
  const svc = () => createReadService({ data, git })

  beforeEach(() => {
    data = fakeData()
    git = fakeGit()
  })

  it('returns the existing live draft without forking', async () => {
    const seeded = await data.saveDraft({ ...ref, content: doc('wip'), metadata: { title: 'WIP' }, baseSha: 'sha0' })
    const r = await svc().loadForEdit(ref)
    expect(r).toEqual({ source: 'draft', draft: seeded })
  })

  it('returns absent when there is no draft and nothing published', async () => {
    expect(await svc().loadForEdit(ref)).toEqual({ source: 'absent' })
  })

  it('forks a draft from published Git content (baseSha = HEAD, empty metadata, persisted)', async () => {
    const md = tiptapToMarkdoc(doc('published body'))
    const { sha } = await git.commitFile({ path: contentPath(ref), content: md, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    expect(r.source).toBe('forked')
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(r.draft.content).toEqual(markdocToTiptap(md))
    expect(r.draft.metadata).toEqual({})
    expect(r.draft.baseSha).toBe(sha)
    // persisted: a second load now finds the live draft
    expect((await svc().loadForEdit(ref)).source).toBe('draft')
  })

  it('round-trips body content through Git: tiptap → publish → open → tiptap', async () => {
    const original = doc('round trip me')
    const md = tiptapToMarkdoc(original)
    await git.commitFile({ path: contentPath(ref), content: md, message: 'm', author })
    const r = await svc().loadForEdit(ref)
    if (r.source !== 'forked') throw new Error('unreachable')
    expect(tiptapToMarkdoc(r.draft.content)).toBe(md)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- read/read-service`
Expected: FAIL — `createReadService` not exported.

- [ ] **Step 4: Implement the service**

Create `packages/core/src/read/read-service.ts`:

```ts
import { markdocToTiptap } from '../markdoc/to-tiptap'
import { contentPath } from '../publish/content-path'
import type { ReadDeps, ReadService } from './types'

/** Read-from-Git: materialize an editable draft for an entry (PRD §2). The
 *  read half of the round-trip — the write half is the publish service. */
export function createReadService(deps: ReadDeps): ReadService {
  const { data, git } = deps

  return {
    async loadForEdit(ref) {
      const existing = await data.getDraft(ref)
      if (existing !== null) return { source: 'draft', draft: existing }

      const published = await git.readFile(contentPath(ref))
      if (published === null) return { source: 'absent' }

      // Git → Tiptap (the read half of the round-trip). Body only for now;
      // metadata ↔ frontmatter is a later increment, so a forked draft starts
      // with empty metadata.
      const content = markdocToTiptap(published)
      const head = await git.headSha()
      const draft = await data.saveDraft({ ...ref, content, metadata: {}, baseSha: head })
      return { source: 'forked', draft }
    },
  }
}
```

- [ ] **Step 5: Export the read surface from the package index**

Edit `packages/core/src/index.ts` — append:

```ts
export type { LoadResult, ReadDeps, ReadService } from './read/types'
export { createReadService } from './read/read-service'
```

- [ ] **Step 6: Add `src/read` to the edge-portability guard**

Edit `packages/core/tsconfig.edge.json` — change the `include` array to:

```json
  "include": ["src/markdoc", "src/data", "src/authoring", "src/git", "src/publish", "src/read"]
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @saytu/core test -- read/read-service`
Expected: PASS (4 tests).

- [ ] **Step 8: Typecheck (incl. edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean — both the main check and the edge guard (the service uses only `markdocToTiptap` + `contentPath` + injected ports; no Node).

- [ ] **Step 9: Full repo verification (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: every package green — `@saytu/core` 72 (68 prior + 4 new), `@saytu/db-testing` 11, `@saytu/db-sqlite` 12, `@saytu/git-testing` 6, `@saytu/git-local` 9 (= 110 total); typecheck clean across all packages incl. the core edge guard.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/read packages/core/src/index.ts packages/core/tsconfig.edge.json packages/core/test/read
git commit -m "feat(core): read/fork-from-Git service (loadForEdit) — closes the content loop"
```

---

## Self-Review

**Spec coverage:**
- `src/read/types.ts` (`LoadResult` 3-variant union, `ReadDeps`, `ReadService`) → Task 1 Step 1. ✓
- `createReadService({ data, git }).loadForEdit(ref)` flow (existing-draft → draft; readFile null → absent; else markdocToTiptap + headSha + saveDraft → forked) → Task 1 Step 4. ✓
- Forked draft: `content = markdocToTiptap(published)`, `metadata = {}`, `baseSha = HEAD`, persisted → Task 1 Step 4 + the "forks" test. ✓
- Edge-portable; `src/read` in the edge guard → Task 1 Steps 6, 8. ✓
- Tests: existing-draft-wins, absent, forked (content/metadata/baseSha/persisted), publish→open content round-trip-through-Git → Task 1 Step 2. ✓
- Local fakes (no cross-package cycle) → Task 1 Step 2. ✓
- Exports (`createReadService`, types) → Task 1 Step 5. ✓
- Existing 106 tests stay green (core 68 → 72; total 110) → Task 1 Step 9. ✓
- Deferred (metadata↔frontmatter, file-level precision, reindex, config-driven knownBlockTags, locks) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `LoadResult`/`ReadDeps`/`ReadService` defined in Step 1 and implemented in Step 4 with matching shapes. `createReadService(deps): ReadService` and `loadForEdit(ref): Promise<LoadResult>` match the call sites. The `forked`/`draft`/`absent` discriminant is narrowed via `if (r.source !== 'forked') throw` before accessing `.draft`. The fake `DataPort` implements all 8 methods; the fake `GitPort` implements `headSha`/`readFile`/`commitFile` returning `{ sha }`. `saveDraft({ ...ref, content, metadata: {}, baseSha: head })` matches `DraftInput` (baseSha is `string | null`). ✓
