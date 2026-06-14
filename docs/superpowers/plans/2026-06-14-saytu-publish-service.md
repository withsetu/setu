# Publish Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the publish service to `@saytu/core` — compile a DB draft to Markdoc and commit it to Git via GitPort, with a base-SHA conflict guard (PRD §2).

**Architecture:** A pure `contentPath(ref)` helper + `createPublishService({ data, git })` that orchestrates `DataPort.getDraft` → `tiptapToMarkdoc` → `GitPort.commitFile`, guards on the draft's `baseSha` vs current HEAD, and advances the draft's `baseSha` to the new commit. No UI, no Node — edge-portable.

**Tech Stack:** TypeScript (strict), Vitest. Consumes `DataPort`, `GitPort`, and `tiptapToMarkdoc` — all already exported from `@saytu/core`.

**Spec:** `docs/superpowers/specs/2026-06-14-saytu-publish-service-design.md`

---

## File Structure

```
packages/core/src/publish/
├── types.ts             # PublishInput, PublishDeps, PublishResult, PublishService
├── content-path.ts      # contentPath(ref): string  (pure)
└── publish-service.ts   # createPublishService(deps)
packages/core/src/index.ts        # + re-export the publish surface
packages/core/tsconfig.edge.json  # + "src/publish" in include
packages/core/test/publish/
├── content-path.test.ts
└── publish-service.test.ts        # local fake DataPort + fake GitPort
```

---

### Task 1: `contentPath` + publish types

**Files:**
- Create: `packages/core/src/publish/types.ts`
- Create: `packages/core/src/publish/content-path.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tsconfig.edge.json`
- Test: `packages/core/test/publish/content-path.test.ts`

- [ ] **Step 1: Create the types**

Create `packages/core/src/publish/types.ts`:

```ts
import type { EntryRef } from '../data/types'
import type { DataPort } from '../data/data-port'
import type { GitAuthor } from '../git/types'
import type { GitPort } from '../git/git-port'

export interface PublishInput {
  ref: EntryRef
  /** Commit author (the editor identity). */
  author: GitAuthor
  /** Commit message; defaults to `Publish <collection>/<locale>/<slug>`. */
  message?: string
}

export interface PublishDeps {
  data: DataPort
  git: GitPort
}

/** Outcome of a publish attempt. */
export type PublishResult =
  /** Committed; `sha` is the new HEAD, `path` the committed file. */
  | { status: 'published'; sha: string; path: string }
  /** Blocked: the repo advanced since the draft forked (HEAD-level guard).
   *  Nothing was committed. */
  | { status: 'conflict'; baseSha: string; headSha: string }
  /** No draft exists for `ref` — nothing to publish. */
  | { status: 'nothing' }

export interface PublishService {
  publish(input: PublishInput): Promise<PublishResult>
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/test/publish/content-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { contentPath } from '../../src/index'

describe('contentPath', () => {
  it('builds content/<collection>/<locale>/<slug>.mdoc', () => {
    expect(contentPath({ collection: 'post', locale: 'en', slug: 'hello' })).toBe('content/post/en/hello.mdoc')
  })

  it('reflects locale and collection distinctly', () => {
    expect(contentPath({ collection: 'page', locale: 'fr', slug: 'about' })).toBe('content/page/fr/about.mdoc')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- publish/content-path`
Expected: FAIL — `contentPath` not exported.

- [ ] **Step 4: Implement contentPath**

Create `packages/core/src/publish/content-path.ts`:

```ts
import type { EntryRef } from '../data/types'

/** Repo-relative path for an entry's Markdoc file:
 *  `content/<collection>/<locale>/<slug>.mdoc`. */
export function contentPath(ref: EntryRef): string {
  return `content/${ref.collection}/${ref.locale}/${ref.slug}.mdoc`
}
```

- [ ] **Step 5: Export the publish surface from the package index**

Edit `packages/core/src/index.ts` — append:

```ts
export type { PublishInput, PublishDeps, PublishResult, PublishService } from './publish/types'
export { contentPath } from './publish/content-path'
```

- [ ] **Step 6: Add `src/publish` to the edge-portability guard**

Edit `packages/core/tsconfig.edge.json` — change the `include` array to:

```json
  "include": ["src/markdoc", "src/data", "src/authoring", "src/git", "src/publish"]
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @saytu/core test -- publish/content-path`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck (incl. edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean — both the main check and the edge guard (types + the pure path helper are Node-free).

- [ ] **Step 9: Run the full core suite**

Run: `pnpm --filter @saytu/core test`
Expected: PASS — 61 tests (59 prior + 2 new).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/publish/types.ts packages/core/src/publish/content-path.ts packages/core/src/index.ts packages/core/tsconfig.edge.json packages/core/test/publish/content-path.test.ts
git commit -m "feat(core): contentPath + publish types"
```

---

### Task 2: `createPublishService`

**Files:**
- Create: `packages/core/src/publish/publish-service.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/publish/publish-service.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/core/test/publish/publish-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPublishService, tiptapToMarkdoc } from '../../src/index'
import type {
  CommitInput,
  DataPort,
  Draft,
  EntryRef,
  GitPort,
  Lock,
  TiptapDoc,
} from '../../src/index'

const key = (r: EntryRef) => `${r.collection} ${r.locale} ${r.slug}`
const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

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

/** In-memory GitPort that also records commits, for message assertions. */
interface RecordingGit extends GitPort {
  commits: CommitInput[]
}
function fakeGit(): RecordingGit {
  const files = new Map<string, string>()
  const commits: CommitInput[] = []
  let counter = 0
  let head: string | null = null
  return {
    commits,
    async headSha() {
      return head
    },
    async readFile(path) {
      return head === null ? null : files.get(path) ?? null
    },
    async commitFile(input) {
      commits.push(input)
      files.set(input.path, input.content)
      head = `gitsha${++counter}`
      return { sha: head }
    },
  }
}

describe('createPublishService', () => {
  let data: DataPort
  let git: RecordingGit
  const ref: EntryRef = { collection: 'post', locale: 'en', slug: 'hello' }
  const author = { name: 'Ed', email: 'ed@x.com' }
  const svc = () => createPublishService({ data, git })

  beforeEach(() => {
    data = fakeData()
    git = fakeGit()
  })

  it('returns nothing when there is no draft (git untouched)', async () => {
    const r = await svc().publish({ ref, author })
    expect(r).toEqual({ status: 'nothing' })
    expect(await git.headSha()).toBeNull()
  })

  it('first publish commits the compiled markdoc and advances baseSha', async () => {
    await data.saveDraft({ ...ref, content: doc('hi'), metadata: { title: 'T' } }) // baseSha null
    const r = await svc().publish({ ref, author })
    expect(r.status).toBe('published')
    if (r.status !== 'published') throw new Error('unreachable')
    expect(r.path).toBe('content/post/en/hello.mdoc')
    expect(r.sha).toBe('gitsha1')
    expect(await git.readFile(r.path)).toBe(tiptapToMarkdoc(doc('hi')))
    expect((await data.getDraft(ref))?.baseSha).toBe('gitsha1')
  })

  it('republish after an edit does not falsely conflict', async () => {
    await data.saveDraft({ ...ref, content: doc('v1'), metadata: {} })
    expect((await svc().publish({ ref, author })).status).toBe('published')
    const cur = (await data.getDraft(ref))!
    await data.saveDraft({ ...ref, content: doc('v2'), metadata: {}, baseSha: cur.baseSha })
    const second = await svc().publish({ ref, author })
    expect(second.status).toBe('published')
    if (second.status !== 'published') throw new Error('unreachable')
    expect(second.sha).toBe('gitsha2')
    expect(await git.readFile(second.path)).toBe(tiptapToMarkdoc(doc('v2')))
  })

  it('blocks with conflict when the repo advanced since the draft forked', async () => {
    await git.commitFile({ path: 'other.mdoc', content: 'x', message: 'm', author }) // head → gitsha1
    await data.saveDraft({ ...ref, content: doc('mine'), metadata: {}, baseSha: 'stale-sha' })
    const r = await svc().publish({ ref, author })
    expect(r).toEqual({ status: 'conflict', baseSha: 'stale-sha', headSha: 'gitsha1' })
    expect(await git.readFile('content/post/en/hello.mdoc')).toBeNull() // nothing of mine committed
    expect((await data.getDraft(ref))?.baseSha).toBe('stale-sha') // baseSha NOT advanced
  })

  it('uses a default commit message and passes a custom one through', async () => {
    await data.saveDraft({ ...ref, content: doc('a'), metadata: {} })
    await svc().publish({ ref, author })
    expect(git.commits.at(-1)?.message).toBe('Publish post/en/hello')

    const ref2: EntryRef = { collection: 'post', locale: 'en', slug: 'two' }
    await data.saveDraft({ ...ref2, content: doc('b'), metadata: {} })
    await svc().publish({ ref: ref2, author, message: 'custom msg' })
    expect(git.commits.at(-1)?.message).toBe('custom msg')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saytu/core test -- publish/publish-service`
Expected: FAIL — `createPublishService` not exported.

- [ ] **Step 3: Implement the service**

Create `packages/core/src/publish/publish-service.ts`:

```ts
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { contentPath } from './content-path'
import type { PublishDeps, PublishInput, PublishResult, PublishService } from './types'

/** Compile a draft to Markdoc and commit it to Git (PRD §2). */
export function createPublishService(deps: PublishDeps): PublishService {
  const { data, git } = deps

  return {
    async publish({ ref, author, message }: PublishInput): Promise<PublishResult> {
      const draft = await data.getDraft(ref)
      if (draft === null) return { status: 'nothing' }

      const headSha = await git.headSha()
      // HEAD-level base-SHA guard (§2): block if the repo advanced since the
      // draft forked. Never silently overwrites an external commit.
      if (draft.baseSha !== null && headSha !== null && draft.baseSha !== headSha) {
        return { status: 'conflict', baseSha: draft.baseSha, headSha }
      }

      const path = contentPath(ref)
      const content = tiptapToMarkdoc(draft.content)
      const commitMessage = message ?? `Publish ${ref.collection}/${ref.locale}/${ref.slug}`
      const { sha } = await git.commitFile({ path, content, message: commitMessage, author })

      // Advance the draft's base to the new commit so continued editing forks
      // from the just-published state and the next conflict check is correct.
      await data.saveDraft({
        ...ref,
        content: draft.content,
        metadata: draft.metadata,
        baseSha: sha,
      })

      return { status: 'published', sha, path }
    },
  }
}
```

- [ ] **Step 4: Export the service**

Edit `packages/core/src/index.ts` — add below the `contentPath` export:

```ts
export { createPublishService } from './publish/publish-service'
```

- [ ] **Step 5: Run the service test**

Run: `pnpm --filter @saytu/core test -- publish/publish-service`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck (incl. edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean — the service uses only `tiptapToMarkdoc` (pure) + the injected ports; no Node, so it passes the edge guard now covering `src/publish`.

- [ ] **Step 7: Full repo verification (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: every package green — `@saytu/core` 66 (59 prior + 2 content-path + 5 service), `@saytu/db-testing` 11, `@saytu/db-sqlite` 12, `@saytu/git-testing` 6, `@saytu/git-local` 9 (= 104 total); typecheck clean across all packages incl. the core edge guard.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/publish/publish-service.ts packages/core/src/index.ts packages/core/test/publish/publish-service.test.ts
git commit -m "feat(core): createPublishService — draft → Markdoc → Git commit"
```

---

## Self-Review

**Spec coverage:**
- `contentPath(ref)` → `content/<collection>/<locale>/<slug>.mdoc` → Task 1. ✓
- `PublishInput`/`PublishDeps`/`PublishResult`/`PublishService` types → Task 1. ✓
- `createPublishService({ data, git }).publish` → Task 2. ✓
- Flow: getDraft → nothing; headSha; HEAD-level guard (baseSha!=null && head!=null && baseSha!==head → conflict, no commit); tiptapToMarkdoc; commitFile; advance baseSha; published → Task 2 Step 3 + tests. ✓
- After publish keeps the draft, advances baseSha → Task 2 test "first publish … advances baseSha". ✓
- Conflict does NOT commit and does NOT advance baseSha → Task 2 test "blocks with conflict". ✓
- Default + custom commit message → Task 2 test "uses a default … passes a custom". ✓
- Edge-portable; `src/publish` in the edge guard → Task 1 Steps 6, 8; Task 2 Step 6. ✓
- Local fakes (no cross-package cycle) → Task 2 Step 1. ✓
- Exports (`createPublishService`, `contentPath`, types) → Tasks 1 & 2. ✓
- Existing 97 tests stay green (core 59 → 66; total 104) → Task 2 Step 7. ✓
- Deferred (file-level guard, fork-from-Git, reindex, deploy hook, redirects, publish authz, lock coordination) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `PublishInput`/`PublishDeps`/`PublishResult`/`PublishService` defined in Task 1 and implemented in Task 2 with matching shapes. `createPublishService(deps): PublishService` and `publish(input): Promise<PublishResult>` match call sites. `contentPath(ref): string` used identically in the service and tests. The fake `DataPort` implements all 8 methods; the fake `GitPort` implements `headSha`/`readFile`/`commitFile` and `CommitInput`/`{sha}` shapes match. The discriminated `PublishResult` is narrowed via `if (r.status !== 'published') throw` before accessing `.sha`/`.path`. ✓
