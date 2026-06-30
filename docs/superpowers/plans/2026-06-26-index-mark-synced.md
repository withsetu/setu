# Index "mark synced" — close the partial-reindex staleness window

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the per-`reindexEntry` `indexedSha` advance (which can prematurely mark the index "synced" after a multi-file out-of-band commit) with an explicit `markSyncedAt(sha)` the admin calls ONCE after a publish/bulk batch — so a real out-of-band multi-file commit is fully imported, while a normal admin publish still avoids a full rebuild on next load.

**Architecture:** `reindexEntry` goes back to updating only the entry (no meta write). A new `markSyncedAt(sha)` sets `indexedSha = sha`. The admin calls it after it has reindexed every entry a commit changed: after publish (`r.sha`), and after each bulk `applyMetadata` (`res.committedSha`).

**Tech Stack:** `@setu/core` (vitest, memory ports), admin React (`EditorScreen`, `tags-store`, `BulkBar`).

## Global Constraints

- `reindexEntry` writes ONLY the entry — no `index.setMeta`.
- `markSyncedAt(sha)` sets `indexedSha = sha`, preserving `version`.
- Admin calls `markSyncedAt` once per commit, AFTER reindexing all the commit's changed entries: publish → `r.sha`; bulk → `res.committedSha` (skip when null).
- A multi-file out-of-band commit with only one entry reindexed must STILL be fully imported on next `ensureBuilt`.
- Existing index/admin suites stay green.

---

### Task 1: `markSyncedAt` in core + remove the per-entry advance + tests

**Files:**
- Modify: `packages/core/src/index-port/index-service.ts`
- Modify: `packages/core/src/index-port/index-service-import.test.ts`

**Interfaces:**
- Produces: `IndexService.markSyncedAt(sha: string): Promise<void>`. `reindexEntry` no longer writes meta.

- [ ] **Step 1: Replace the test file**

Replace `packages/core/src/index-port/index-service-import.test.ts` entirely with:

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIndexService } from './index-service'

const mdoc = (title: string) => `---\ntitle: ${title}\n---\n\nbody\n`
const author = { name: 'x', email: 'x@y.z' }
const q = { collection: 'post', offset: 0, limit: 50 } as const

// Wrap a memory GitPort to count rebuilds (rebuild() is the only caller of git.list).
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
    expect(listCalls()).toBe(before)
  })

  it('never loops on an empty repo (HEAD null)', async () => {
    const { git, listCalls } = spyGit([])
    const service = serviceWith(git)
    await service.ensureBuilt()
    const before = listCalls()
    await service.ensureBuilt()
    await service.ensureBuilt()
    expect(listCalls()).toBe(before)
  })

  it('imports ALL files from a multi-file out-of-band commit even if only one was reindexed', async () => {
    const { git } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    // One out-of-band commit adds b AND c.
    await git.commitFiles({
      changes: [
        { path: 'content/post/en/b.mdoc', content: mdoc('B') },
        { path: 'content/post/en/c.mdoc', content: mdoc('C') },
      ],
      message: 'seed two',
      author,
    })
    // The admin reindexes only ONE of them (e.g. the user opened+saved b) and does NOT markSyncedAt.
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    await service.ensureBuilt() // indexedSha still lags HEAD → full rebuild imports a, b AND c
    expect((await service.query(q)).total).toBe(3)
  })

  it('reindexEntry alone does NOT advance indexedSha (next load still imports)', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    await git.commitFile({ path: 'content/post/en/b.mdoc', content: mdoc('B'), message: 'x', author })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'b' })
    const before = listCalls()
    await service.ensureBuilt() // indexedSha lags → rebuild
    expect(listCalls()).toBeGreaterThan(before)
  })

  it('markSyncedAt after reindexing the changed entry prevents a full rebuild on next load', async () => {
    const { git, listCalls } = spyGit([{ path: 'content/post/en/a.mdoc', content: mdoc('A') }])
    const service = serviceWith(git)
    await service.ensureBuilt()
    const { sha } = await git.commitFile({ path: 'content/post/en/a.mdoc', content: mdoc('A2'), message: 'edit', author })
    await service.reindexEntry({ collection: 'post', locale: 'en', slug: 'a' })
    await service.markSyncedAt(sha) // admin marks synced after reindexing the commit's entries
    const before = listCalls()
    await service.ensureBuilt() // indexedSha === HEAD → no rebuild
    expect(listCalls()).toBe(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @setu/core exec vitest run src/index-port/index-service-import.test.ts`
Expected: FAIL — `service.markSyncedAt is not a function`; and (with the current per-entry advance still in place) the multi-file test would import only 2.

- [ ] **Step 3: Revert `reindexEntry` to entry-only (drop the meta write)**

In `packages/core/src/index-port/index-service.ts`, replace the whole `reindexEntry` function with:

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
```

- [ ] **Step 4: Add `markSyncedAt`**

Immediately after `reindexAfterDeploy` in the same file, add:

```ts
  /** Record that the index now reflects committed content at `sha`. The admin calls this
   *  ONCE after it has reindexed every entry a publish/bulk commit changed, so ensureBuilt's
   *  out-of-band sha-gate won't rebuild for that commit. A true out-of-band multi-file commit
   *  (whose entries the admin never reindexed) leaves indexedSha behind HEAD and is imported. */
  async function markSyncedAt(sha: string): Promise<void> {
    const meta = await index.getMeta()
    await index.setMeta({ ...meta, indexedSha: sha })
  }
```

- [ ] **Step 5: Add `markSyncedAt` to the interface + the returned object**

In the `IndexService` interface (same file), add after `reindexAfterDeploy(): Promise<void>`:

```ts
  markSyncedAt(sha: string): Promise<void>
```

And in the final `return { ... }`, add `markSyncedAt` to the list (e.g. after `reindexAfterDeploy`).

- [ ] **Step 6: Run the test + full core suite + typecheck**

Run: `pnpm --filter @setu/core exec vitest run src/index-port/index-service-import.test.ts && pnpm --filter @setu/core test && pnpm --filter @setu/core typecheck`
Expected: PASS — 6/6 import tests, full core suite green, `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index-port/index-service.ts packages/core/src/index-port/index-service-import.test.ts
git commit -m "feat(core): explicit markSyncedAt replaces per-entry indexedSha advance"
```

---

### Task 2: Wire `markSyncedAt` into the admin commit sites

**Files:**
- Modify: `apps/admin/src/editor/EditorScreen.tsx` (post-publish reindex)
- Modify: `apps/admin/src/data/tags-store.tsx` (rename + remove)
- Modify: `apps/admin/src/screens/BulkBar.tsx` (bulk run)

**Interfaces:**
- Consumes: `index.markSyncedAt(sha)` (Task 1); publish result `r.sha`; bulk `res.committedSha`.

- [ ] **Step 1: Wire the publish path (EditorScreen)**

In `apps/admin/src/editor/EditorScreen.tsx`, in `commit()`, replace the post-publish block:

```ts
      if (r.status === 'published') {
        baseShaRef.current = r.sha
        notify.success('Published · ' + r.sha.slice(0, 7))
        reindex(ref)
        await refreshLifecycle()
      } else if (r.status === 'conflict') {
```

with (await the reindex, then mark synced at the committed sha):

```ts
      if (r.status === 'published') {
        baseShaRef.current = r.sha
        notify.success('Published · ' + r.sha.slice(0, 7))
        await index.reindexEntry(ref).catch(() => {})
        await index.markSyncedAt(r.sha).catch(() => {})
        await refreshLifecycle()
      } else if (r.status === 'conflict') {
```

(The pre-publish `reindex(ref)` on the line above the `publish.publish` call is a draft-save reindex — leave it unchanged; no commit has happened there.)

- [ ] **Step 2: Wire the tag bulk ops (tags-store)**

In `apps/admin/src/data/tags-store.tsx`, in BOTH `rename` and `remove`, after the reindex loop, add the mark-synced line:

`rename` (after `for (const ref of res.applied) await index.reindexEntry(ref).catch(() => {})`):

```ts
      if (res.committedSha) await index.markSyncedAt(res.committedSha).catch(() => {})
```

`remove` (after its identical reindex loop):

```ts
      if (res.committedSha) await index.markSyncedAt(res.committedSha).catch(() => {})
```

- [ ] **Step 3: Wire the bulk bar**

In `apps/admin/src/screens/BulkBar.tsx`, widen the `run` op type to include `committedSha` and add the mark-synced call after the reindex loop:

```ts
  const run = async (
    op: () => Promise<{ committedSha: string | null; applied: EntryRef[]; skipped: { ref: EntryRef }[] }>,
    label: string,
  ) => {
    setBusy(true)
    try {
      const r = await op()
      for (const ref of r.applied) await index.reindexEntry(ref).catch(() => {})
      if (r.committedSha) await index.markSyncedAt(r.committedSha).catch(() => {})
      const skipped = r.skipped.length ? ` · ${r.skipped.length} skipped` : ''
```

(Leave the rest of `run` unchanged.)

- [ ] **Step 4: Run the admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS. If a test constructs a partial `IndexService` mock lacking `markSyncedAt`, give that mock a `markSyncedAt: async () => {}` stub — do not weaken the production call sites.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/EditorScreen.tsx apps/admin/src/data/tags-store.tsx apps/admin/src/screens/BulkBar.tsx
git commit -m "fix(admin): mark the index synced after each publish/bulk commit"
```

---

## Self-Review

**Spec coverage:** per-entry advance removed (Task 1 step 3); explicit `markSyncedAt` (steps 4–5); multi-file-out-of-band-then-single-reindex now imports all (test 4); normal publish/bulk avoid a full rebuild via `markSyncedAt` at every commit site (Task 2 steps 1–3, test 6). ✓

**Placeholder scan:** none — complete code; the `git.list` spy detects rebuilds.

**Type consistency:** `markSyncedAt(sha: string)` added to the interface, impl, and return; consumed in EditorScreen (`r.sha`), tags-store (`res.committedSha`), BulkBar (`r.committedSha`). The BulkBar `run` op type gains `committedSha: string | null` to match `applyMetadata`'s return.
