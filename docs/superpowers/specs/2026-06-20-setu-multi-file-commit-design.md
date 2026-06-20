# Multi-file Git Commit — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Add an atomic multi-file commit (`commitFiles`, writes + deletes in one commit) to the `GitPort` seam and all four adapters + the `@setu/api` git route + the shared contract. The keystone foundation for bulk operations, bulk publish/delete, and category delete/slug-rename.

## Problem & intent

`GitPort` today commits exactly one file per call (`commitFile`) and has **no delete**. That blocks anything that must change several files atomically or remove published content:
- **Bulk operations** (Slice 2): publishing/deleting many entries should be one clean commit, not N ugly single-file commits.
- **Bulk delete / category delete / slug-rename**: all need to *remove* a Git file or rewrite many entry files in one commit.

This slice adds the capability with no UI. It is the keystone the deferred features were waiting on.

## Decisions (locked in brainstorm)

- **One new method `commitFiles({ changes, message, author })`** — all changes in a single atomic commit.
- **`FileChange` is a discriminated union:** `{ path, content }` (write/create/update) or `{ path, delete: true }` (remove). Explicit `delete: true` rather than an implicit `content: null`.
- **`commitFile` is kept** (many callers) but **reimplemented in each adapter as `commitFiles([{ path, content }])`** — one commit code path per adapter, no divergence. The existing contract proves behavior is unchanged.
- **All four adapters + the `@setu/api` git route** implement it (the shared `runGitPortContract` runs against all four, including git-http which tests through the real route).
- **No-op semantics:** empty `changes`, or a changeset that nets to nothing (only deletes of absent paths), makes **no commit** and returns the current `headSha` (git-local cannot make empty commits).
- **Delete of an absent path is tolerated** (skipped), not an error.

## Non-goals (consume this, but are their own slices)

- The bulk-operations UI (Slice 2).
- Category delete & slug-rename.
- Any change to how `commitFile`'s callers behave.

## Architecture

### 1. Core types (`packages/core/src/git/types.ts`)
```ts
/** One change in a multi-file commit: a write (create/update) or a delete. */
export type FileChange =
  | { path: string; content: string }
  | { path: string; delete: true }

/** A multi-file commit request: all changes land in one atomic commit. */
export interface CommitFilesInput {
  changes: FileChange[]
  message: string
  author: GitAuthor
}
```
A helper to distinguish at runtime: a change is a delete when `'delete' in change` (and `change.delete === true`); otherwise it is a write with `content`.

### 2. GitPort interface (`packages/core/src/git/git-port.ts`)
Add:
```ts
/** Apply several writes/deletes in ONE atomic commit; returns the new HEAD
 *  sha. Empty or net-empty changesets make no commit and return current HEAD. */
commitFiles(input: CommitFilesInput): Promise<CommitResult>
```
`commitFile` stays in the interface.

Export `FileChange`, `CommitFilesInput` from the core barrel (`packages/core/src/index.ts`).

### 3. Uniform semantics (locked by the contract)
- All changes → **one commit**; HEAD advances exactly once.
- **Writes** create/update the path (parent dirs created as needed).
- **Deletes** remove the path; absent path → skipped.
- **Empty / net-empty** changeset → no commit, return current `headSha`.
- Changes applied in array order (duplicate path → last wins).
- **Repo-root-escape check** on every write/delete path (git-local already does this for `commitFile`; `commitFiles` keeps it).

### 4. Per-adapter
- **git-memory** (`adapter.ts`): one pass — `files.set` writes, `files.delete` deletes; advance head/counter once over the batch. If the batch makes no actual change, return current head without advancing. `commitFile` → `commitFiles([{ path, content }])`.
- **git-idb** (`adapter.ts`): one `readwrite` transaction over `files` + `meta` — `put` writes, `delete` deletes; one counter/head update; skip if net-empty. `commitFile` delegates.
- **git-local** (`adapter.ts`): inside the existing `serialize(...)` — for each write: `mkdir` + `writeFile` + `git.add`; for each delete: remove the working file (if present) + `git.remove`; then a single `git.commit`. On failure, reset the index for all touched paths (extend the current reset-on-fail). If nothing was staged, return current head (no commit). `commitFile` delegates.
- **git-http** (`adapter.ts`): `commitFiles` POSTs `CommitFilesInput` to a new `/git/commit-files` endpoint; returns `{ sha }`. `commitFile` delegates to `commitFiles`.
- **`@setu/api` git route** (`apps/api/src/app.ts`): add `app.post('/git/commit-files', …)` that reads a `CommitFilesInput` body and calls `git.commitFiles(body)`, returning `{ sha }`. (Separate from the media/upload routes — coordinate only on this file with the media session.)

### 5. Contract (`packages/git-testing/src/index.ts`)
Add to `runGitPortContract` (runs for all four adapters):
- multi-write in one commit: two paths committed together are both readable and HEAD advanced once.
- delete removes a file: write then `commitFiles([{ path, delete: true }])` → `readFile` is null, path gone from `list`.
- mixed write + delete in one commit.
- empty `changes` → HEAD unchanged (no commit), returns current head.
- delete of an absent path → tolerated (no throw); a changeset of only-absent-deletes makes no commit.

## Error handling / edges
- Empty/net-empty changeset → no commit (no empty-commit error from git-local).
- Delete-absent → skipped silently.
- Path escaping the repo root (git-local) → throws, index left clean.
- A write and delete of the **same** path in one batch → applied in order (last wins); not a special error.
- git-http: a non-2xx from `/git/commit-files` → throws (same as the existing `commitFile` error mapping).

## Testing
- **Contract** (all four adapters): the five cases above, plus the existing `commitFile` cases continue to pass (proving the delegation preserves behavior).
- **git-local specifics**: a focused test that a delete actually removes the file from the working tree and from `git.listFiles`, and that a failed `commitFiles` leaves the index clean.
- **`@setu/api`**: a route test that `POST /git/commit-files` with writes+deletes returns the new sha and the changes are visible via `/git/file` / `/git/list` (mirrors the existing `/git/commit` route test).

## Sequencing
1. **This slice:** `commitFiles` across GitPort + 4 adapters + api route + contract; `commitFile` delegated.
2. **Next (Slice 2):** bulk operations UI (selection + assign/remove category & tag, change status, delete, publish) — consumes `commitFiles`.
3. **Also unblocked:** category delete & slug-rename (rewrite/remove referencing entries in one commit).
