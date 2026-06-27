# Admin Content Import (sha-aware index) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The admin's content list must reflect *any* content in the Git repo — seeded, directly committed, or written by another tool — not only content the admin itself created. Today the index only rebuilds on a schema-version change, so out-of-band content is invisible.

**Architecture:** Two surgical changes to `createIndexService` in `@setu/core`: (1) `ensureBuilt` also rebuilds when the index's recorded `indexedSha` lags the live Git HEAD (importing out-of-band content on the next admin load); (2) `reindexEntry` bumps `indexedSha` to the current HEAD so admin-originated commits (publish/bulk, which already reindex their changed entries) keep the marker in sync — meaning the new sha-gate never triggers a spurious full rebuild after a normal edit. A null HEAD (empty repo) never triggers a rebuild, preserving the existing no-loop guard.

**Tech Stack:** `@setu/core` (vitest), memory ports from `@setu/db-memory` + `@setu/git-memory`.

## Global Constraints

- **`ensureBuilt` rebuilds when:** `version !== INDEX_VERSION` **OR** (`head !== null && head !== indexedSha`).
- **`reindexEntry` sets `indexedSha = await git.headSha()`** after updating the entry (keeps admin commits synced; a no-commit draft save sets it to the unchanged head — a no-op).
- **Empty repo (`head === null`) never rebuilds** past the first version-gated build (no loop).
- **No admin-side change needed** — `IndexProvider` already calls `ensureBuilt()` on mount, so content imports on the next load.
- Existing index-service behavior + the full core suite stay green.

---

### Task 1: sha-aware `ensureBuilt` + `reindexEntry` sync

**Files:**
- Modify: `packages/core/src/index-port/index-service.ts`
- Test: `packages/core/src/index-port/index-service-import.test.ts`

**Interfaces:**
- Consumes: existing `IndexServiceDeps` (`data`, `git`, `index`, `deployedAt`); memory ports `createMemoryDataPort`, `createMemoryIndexPort` (`@setu/db-memory`), `createMemoryGitPort` (`@setu/git-memory`).
- Produces: no signature change — `ensureBuilt`/`reindexEntry` behavior change only.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/index-port/index-service-import.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIndexService } from './index-service'

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const

// Wrap a memory GitPort so we can count rebuilds (rebuild() is the only caller of git.list).
function spyGit(seed: { path: string; content: string }[]) {
  const base = createMemoryGitPort(seed)
  let listCalls = 0
  const git = { ...base, async list(prefix?: string) { listCalls++; return base.list(prefix) } }
  return { git, listCalls: () => listCalls }
}

function serviceWith(git: ReturnType<typeof spyGit>['git']) {
  return createIndexService({
    data: createMemoryDataPort(),
    git,
    index: createMemoryIndexPort(),
    deployedAt: () => null,
  })
}

describe('createIndexService — out-of-band content import', () => {
  it('imports content committed out-of-band (rebuilds when HEAD moved past indexedSha)', async () => {
    const { git } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    expect((await service.query(q)).total).toBe(1)

    // Out-of-band: a new file committed directly, not through the admin.
    await git.commitFile({ path: 'content/post/en/b.mdoc', content: mdoc('B'), message: 'seed', author })
    await service.ensureBuilt()
    expect((await service.query(q)).total).toBe(2)
  })

  it('does not rebuild when the index is already in sync (HEAD === indexedSha)', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    const before = listCalls()
    await service.ensureBuilt()
    expect(listCalls()).toBe(before) // no extra rebuild
  })

  it('never loops on an empty repo (HEAD null)', async () => {
    const { git, listCalls } = spyGit([])
    const service = serviceWith(git)
    await service.ensureBuilt() // version gate → one (empty) rebuild
    const before = listCalls()
    await service.ensureBuilt()
    await service.ensureBuilt()
    expect(listCalls()).toBe(before) // head null → no further rebuilds
  })

  it('reindexEntry syncs indexedSha so a normal edit does not force a full rebuild', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    // Admin-style commit + incremental reindex (what publish does).
    await git.commitFile({ path: 'content/post/en/a.mdoc', content: mdoc('A2'), message: 'edit', author })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    const before = listCalls()
    await service.ensureBuilt() // indexedSha now === HEAD → must NOT rebuild
    expect(listCalls()).toBe(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run src/index-port/index-service-import.test.ts`
Expected: FAIL — the out-of-band import test sees `total` 1 (no sha-gate rebuild); the reindex-sync test rebuilds (listCalls increments).

- [ ] **Step 3: Make `ensureBuilt` sha-aware**

In `packages/core/src/index-port/index-service.ts`, replace the `ensureBuilt` function with:

```ts
  async function ensureBuilt(): Promise<void> {
    const meta = await index.getMeta()
    // Cold start / schema change → full build.
    if (meta.version !== INDEX_VERSION) {
      await rebuild()
      return
    }
    // Import content that changed out-of-band (seeded, directly committed, or the admin
    // pointed at a different repo): the index is stale when its recorded sha lags the live
    // HEAD. A null HEAD (empty default repo) never triggers this, so there is no rebuild loop.
    const head = await git.headSha()
    if (head !== null && head !== meta.indexedSha) await rebuild()
  }
```

- [ ] **Step 4: Sync `indexedSha` in `reindexEntry`**

In the same file, replace the `reindexEntry` function with:

```ts
  async function reindexEntry(ref: EntryRef): Promise<void> {
    const draft = await data.getDraft(ref)
    const committedStr = await git.readFile(contentPath(ref))
    const drafts = draft ? [draft] : []
    const committed = committedStr !== null ? [{ ref, content: committedStr }] : []
    const rows = listContentEntries({ drafts, committed, deployedAt })
    if (rows.length === 0) await index.remove(indexKey(ref))
    else await index.upsert(projectRow(rows[0]!))
    // Keep the index's sha marker in step with admin-originated commits (every admin
    // commit reindexes its changed entries) so ensureBuilt's out-of-band sha-gate does
    // not trigger a spurious full rebuild after a normal publish/edit. A no-commit draft
    // save sets it to the unchanged HEAD — a no-op.
    const meta = await index.getMeta()
    await index.setMeta({ ...meta, indexedSha: await git.headSha() })
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @setu/core exec vitest run src/index-port/index-service-import.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 6: Run the full core suite + typecheck**

Run: `pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — existing index/admin behavior unchanged, `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index-port/index-service.ts packages/core/src/index-port/index-service-import.test.ts
git commit -m "feat(core): admin imports out-of-band content (sha-aware index rebuild)"
```

---

## Self-Review

**Spec coverage:** out-of-band import via sha-gated `ensureBuilt` (Task 1, steps 3 + test 1); no spurious rebuild when synced (step 3 + tests 2/4); no empty-repo loop (step 3 + test 3); `indexedSha` sync on admin edits (step 4 + test 4). No admin-side change needed (IndexProvider already calls `ensureBuilt`). ✓

**Placeholder scan:** none — complete code + a `git.list` spy that deterministically detects rebuilds.

**Type consistency:** `ensureBuilt`/`reindexEntry` keep their existing signatures; `index.setMeta({ ...meta, indexedSha })` matches `IndexMeta = { indexedSha, version }`. The memory-port imports match the established test pattern (`MetaPanel.test.tsx` uses `createMemoryDataPort`/`createMemoryGitPort` from the same packages).
