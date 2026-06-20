# Multi-file Git Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an atomic multi-file commit (`commitFiles`, writes + deletes in one commit) to `GitPort` and all four adapters + the `@setu/api` git route, with `commitFile` delegated to it.

**Architecture:** A `FileChange` discriminated union (`{path,content}` write | `{path,delete:true}` delete) and `commitFiles({changes,message,author})` on `GitPort`. Each adapter applies all changes in one atomic commit; a net-empty changeset makes no commit and returns the current HEAD. The shared `runGitPortContract` verifies all four adapters behave identically.

**Tech Stack:** TypeScript, isomorphic-git (git-local), idb (git-idb), Hono (`@setu/api`), Vitest.

## Global Constraints

- **`FileChange`** = `{ path: string; content: string }` (write) | `{ path: string; delete: true }` (delete). Distinguish at runtime with `'delete' in change`.
- **`commitFiles({ changes, message, author }): Promise<CommitResult>`** — ALL changes in ONE atomic commit; HEAD advances exactly once.
- **`commitFile` stays** but each adapter reimplements it as `commitFiles({ changes: [{ path, content }], message, author })`.
- **No-op semantics:** empty `changes`, or a changeset that nets to no actual change (writes of identical content, deletes of absent paths), makes **no commit** and returns the current HEAD sha (`''` on a pristine empty repo).
- **Delete of an absent path** is tolerated (skipped), never an error.
- Changes applied in array order (duplicate path → last wins). Per-path **repo-root-escape check** in git-local.
- **Cloudflare-Pages-compatible + cost-safe:** no new runtime deps.
- Core tests colocate `src/**/*.test.ts`; package tests under `test/`.
- Spec: `docs/superpowers/specs/2026-06-20-setu-multi-file-commit-design.md`.

---

### Task 1: `commitFiles` capability — types, interface, all 4 adapters, api route, double fixes

**Files:**
- Modify: `packages/core/src/git/types.ts` (add `FileChange`, `CommitFilesInput`)
- Modify: `packages/core/src/git/git-port.ts` (add `commitFiles`)
- Modify: `packages/core/src/index.ts` (barrel export)
- Modify: `packages/git-memory/src/adapter.ts`
- Modify: `packages/git-idb/src/adapter.ts`
- Modify: `packages/git-local/src/adapter.ts`
- Modify: `packages/git-http/src/adapter.ts`
- Modify: `apps/api/src/app.ts` (`/git/commit-files` route)
- Modify (test doubles — fallout from the required interface method): `packages/git-testing/test/fake-git.test.ts`, `packages/core/test/read/read-service.test.ts`, `packages/core/test/git/types.test.ts`, `packages/core/test/publish/publish-service.test.ts`

**Interfaces:**
- Produces: `FileChange`, `CommitFilesInput` types; `GitPort.commitFiles(input: CommitFilesInput): Promise<CommitResult>`; the `/git/commit-files` POST route.

- [ ] **Step 1: Add the core types**

In `packages/core/src/git/types.ts`, after `CommitInput`:
```ts
/** One change in a multi-file commit: a write (create/update) or a delete. */
export type FileChange =
  | { path: string; content: string }
  | { path: string; delete: true }

/** A multi-file commit request: all changes land in ONE atomic commit. */
export interface CommitFilesInput {
  changes: FileChange[]
  message: string
  author: GitAuthor
}
```

- [ ] **Step 2: Add `commitFiles` to the GitPort interface**

In `packages/core/src/git/git-port.ts`, add to the `GitPort` interface (after `commitFile`):
```ts
  /** Apply several writes/deletes in ONE atomic commit; returns the new HEAD
   *  sha. A net-empty changeset makes no commit and returns the current HEAD. */
  commitFiles(input: CommitFilesInput): Promise<CommitResult>
```
And update the import at the top of the file to include the new type:
```ts
import type { CommitInput, CommitFilesInput, CommitResult } from './types'
```

- [ ] **Step 3: Barrel export**

In `packages/core/src/index.ts`, find the line exporting the git types (e.g. `export type { GitAuthor, CommitInput, CommitResult } from './git/types'`) and add `FileChange, CommitFilesInput`:
```ts
export type { GitAuthor, CommitInput, CommitResult, FileChange, CommitFilesInput } from './git/types'
```
(If the existing export list differs, add `FileChange` and `CommitFilesInput` to whatever git/types export line exists. Run `grep -n "git/types" packages/core/src/index.ts` to find it.)

- [ ] **Step 4: Run typecheck to see the interface break**

Run: `cd packages/core && pnpm typecheck`
Expected: FAIL — the 4 adapters and test doubles don't implement `commitFiles` yet (this confirms the interface change took effect). Proceed to implement.

- [ ] **Step 5: git-memory**

In `packages/git-memory/src/adapter.ts`, update the import and rewrite the returned object to add `commitFiles` and delegate `commitFile`. Replace the `return { ... }` block with:
```ts
import type { CommitInput, CommitFilesInput, CommitResult, GitPort } from '@setu/core'
```
```ts
  const commitFiles = async ({ changes }: CommitFilesInput): Promise<CommitResult> => {
    let changed = false
    for (const ch of changes) {
      if ('delete' in ch) {
        if (files.delete(ch.path)) changed = true
      } else if (files.get(ch.path) !== ch.content) {
        files.set(ch.path, ch.content)
        changed = true
      }
    }
    if (!changed) return { sha: head ?? '' }
    counter += 1
    head = sha40(`${counter}\0${head ?? ''}\0${changes.map((c) => ('delete' in c ? `D:${c.path}` : `W:${c.path}:${c.content}`)).join('\0')}`)
    return { sha: head }
  }

  return {
    async headSha() {
      return head
    },
    async readFile(path: string) {
      return files.has(path) ? files.get(path)! : null
    },
    commitFile(input: CommitInput): Promise<CommitResult> {
      return commitFiles({ changes: [{ path: input.path, content: input.content }], message: input.message, author: input.author })
    },
    commitFiles,
    async list(prefix?: string) {
      const all = [...files.keys()]
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
  }
```
(Leave the `apply` helper + the seed loop as-is — seed still uses `apply`.)

- [ ] **Step 6: git-idb**

In `packages/git-idb/src/adapter.ts`, update the import and rewrite the returned object:
```ts
import type { CommitInput, CommitFilesInput, CommitResult, GitPort } from '@setu/core'
```
```ts
  const commitFiles = async ({ changes }: CommitFilesInput): Promise<CommitResult> => {
    const tx = db.transaction(['files', 'meta'], 'readwrite')
    const filesStore = tx.objectStore('files')
    const meta = tx.objectStore('meta')
    let changed = false
    for (const ch of changes) {
      if ('delete' in ch) {
        if ((await filesStore.get(ch.path)) !== undefined) {
          await filesStore.delete(ch.path)
          changed = true
        }
      } else if (((await filesStore.get(ch.path)) as string | undefined) !== ch.content) {
        await filesStore.put(ch.content, ch.path)
        changed = true
      }
    }
    const prevHead = ((await meta.get('head')) as string | undefined) ?? ''
    if (!changed) {
      await tx.done
      return { sha: prevHead }
    }
    const counter = (((await meta.get('counter')) as number | undefined) ?? 0) + 1
    const sha = sha40(`${counter}\0${prevHead}\0${changes.map((c) => ('delete' in c ? `D:${c.path}` : `W:${c.path}:${c.content}`)).join('\0')}`)
    await meta.put(counter, 'counter')
    await meta.put(sha, 'head')
    await tx.done
    return { sha }
  }

  return {
    async headSha() {
      return ((await db.get('meta', 'head')) as string | undefined) ?? null
    },
    async readFile(path: string) {
      return ((await db.get('files', path)) as string | undefined) ?? null
    },
    commitFile(input: CommitInput): Promise<CommitResult> {
      return commitFiles({ changes: [{ path: input.path, content: input.content }], message: input.message, author: input.author })
    },
    commitFiles,
    async list(prefix?: string) {
      const keys = (await db.getAllKeys('files')) as string[]
      return prefix === undefined ? keys : keys.filter((k) => k.startsWith(prefix))
    },
  }
```

- [ ] **Step 7: git-local**

In `packages/git-local/src/adapter.ts`, refactor: extract a `readFileAtHead` helper (the current `readFile` body) and a `safePath` helper, add `commitFiles`, and delegate `commitFile`. Replace the `return { ... }` block (and keep `headSha`, `serialize`, `isNotFound` as-is) with:
```ts
  const readFileAtHead = async (path: string): Promise<string | null> => {
    const oid = await headSha()
    if (oid === null) return null
    try {
      const { blob } = await git.readBlob({ fs, dir, oid, filepath: path })
      return new TextDecoder().decode(blob)
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  const safePath = (p: string): string => {
    const repoRoot = resolve(dir)
    const full = resolve(repoRoot, p)
    if (full !== repoRoot && !full.startsWith(repoRoot + sep)) {
      throw new Error(`commitFiles: path escapes the repository root: ${p}`)
    }
    return full
  }

  const commitFiles = ({ changes, message, author }: CommitFilesInput): Promise<CommitResult> =>
    serialize(async () => {
      const staged: string[] = []
      try {
        for (const ch of changes) {
          const full = safePath(ch.path)
          if ('delete' in ch) {
            if ((await readFileAtHead(ch.path)) !== null) {
              await fs.promises.unlink(full).catch(() => {})
              await git.remove({ fs, dir, filepath: ch.path })
              staged.push(ch.path)
            }
          } else if ((await readFileAtHead(ch.path)) !== ch.content) {
            await fs.promises.mkdir(dirname(full), { recursive: true })
            await fs.promises.writeFile(full, ch.content, 'utf8')
            await git.add({ fs, dir, filepath: ch.path })
            staged.push(ch.path)
          }
        }
        if (staged.length === 0) return { sha: (await headSha()) ?? '' }
        const sha = await git.commit({ fs, dir, message, author: { name: author.name, email: author.email } })
        return { sha }
      } catch (e) {
        for (const p of staged) await git.resetIndex({ fs, dir, filepath: p }).catch(() => {})
        throw e
      }
    })

  return {
    headSha,
    async readFile(path) {
      return readFileAtHead(path)
    },
    commitFile({ path, content, message, author }) {
      return commitFiles({ changes: [{ path, content }], message, author })
    },
    commitFiles,
    async list(prefix?: string) {
      const oid = await headSha()
      if (oid === null) return []
      const all = await git.listFiles({ fs, dir, ref: 'HEAD' })
      return prefix === undefined ? all : all.filter((p) => p.startsWith(prefix))
    },
  }
```
Update the type import at the top to include `CommitFilesInput`, `CommitResult`:
```ts
import type { GitPort, CommitFilesInput, CommitResult } from '@setu/core'
```

- [ ] **Step 8: `@setu/api` git route**

In `apps/api/src/app.ts`, update the import and add the route after the existing `/git/commit` route:
```ts
import type { GitPort, CommitInput, CommitFilesInput } from '@setu/core'
```
```ts
  app.post('/git/commit-files', async (c) => {
    const body = (await c.req.json()) as CommitFilesInput
    const { sha } = await git.commitFiles(body)
    return c.json({ sha })
  })
```

- [ ] **Step 9: git-http**

In `packages/git-http/src/adapter.ts`, update the import and add `commitFiles` + delegate `commitFile`:
```ts
import type { GitPort, CommitInput, CommitFilesInput, CommitResult } from '@setu/core'
```
Replace the `commitFile` method in the returned object with:
```ts
    commitFile(input: CommitInput): Promise<CommitResult> {
      return this.commitFiles({ changes: [{ path: input.path, content: input.content }], message: input.message, author: input.author })
    },
    async commitFiles(input: CommitFilesInput): Promise<CommitResult> {
      const { sha } = await json<{ sha: string }>(
        await doFetch(url('/git/commit-files'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
      return { sha }
    },
```
NOTE: `commitFile` uses `this.commitFiles` — confirm the returned object is referenced via `this` correctly. If `this` is unreliable here, instead define `const commitFiles = async (input) => {...}` above the `return` and reference it directly from both (preferred). Use the const form:
```ts
  const commitFiles = async (input: CommitFilesInput): Promise<CommitResult> => {
    const { sha } = await json<{ sha: string }>(
      await doFetch(url('/git/commit-files'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      }),
    )
    return { sha }
  }
```
and in the returned object:
```ts
    commitFile(input: CommitInput): Promise<CommitResult> {
      return commitFiles({ changes: [{ path: input.path, content: input.content }], message: input.message, author: input.author })
    },
    commitFiles,
```

- [ ] **Step 10: Fix the test-double fallout**

These inline `GitPort` doubles now fail typecheck (missing `commitFiles`). Fix each:

**`packages/git-testing/test/fake-git.test.ts`** — this fake is run through `runGitPortContract` (which Task 2 extends), so it needs a CORRECT `commitFiles`. Rewrite `createFakeGit` so `commitFile` delegates to a real `commitFiles`:
```ts
function createFakeGit(): GitPort {
  const files = new Map<string, string>()
  let head: string | null = null
  let n = 0
  const commitFiles: GitPort['commitFiles'] = async ({ changes }) => {
    let changed = false
    for (const ch of changes) {
      if ('delete' in ch) {
        if (files.delete(ch.path)) changed = true
      } else if (files.get(ch.path) !== ch.content) {
        files.set(ch.path, ch.content)
        changed = true
      }
    }
    if (!changed) return { sha: head ?? '' }
    n += 1
    head = `sha${n}`
    return { sha: head }
  }
  return {
    async headSha() { return head },
    async readFile(path) { return files.has(path) ? files.get(path)! : null },
    commitFile: (i) => commitFiles({ changes: [{ path: i.path, content: i.content }], message: i.message, author: i.author }),
    commitFiles,
    async list(prefix) {
      const ks = [...files.keys()]
      return prefix === undefined ? ks : ks.filter((k) => k.startsWith(prefix))
    },
  }
}
```

**`packages/core/test/git/types.test.ts`** — add `commitFiles` to the `stub` literal and assert it:
```ts
    const stub: GitPort = {
      headSha: async () => null,
      readFile: async () => null,
      commitFile: async () => ({ sha: 'deadbeef' }),
      commitFiles: async () => ({ sha: 'deadbeef' }),
      list: async () => [],
    }
```

**`packages/core/test/read/read-service.test.ts`** — the `fakeGit()` double (Map + sha + head). Add a `commitFiles` and route `commitFile` through it. In its returned object, add (mirroring the file's existing sha scheme — read the current `commitFile` body and replicate its head/sha bump inside a `commitFiles` that loops the changes; then make `commitFile` delegate). Concretely: define a local `commitFiles` that, for each change, does the same map set/delete the existing `commitFile` did, bumps the sha/head once, and returns it; set `commitFile: (i) => commitFiles({ changes: [{ path: i.path, content: i.content }], message: i.message, author: i.author })`, and add `commitFiles` to the returned object. Keep behavior equivalent for the existing tests (they only use `commitFile` with new content).

**`packages/core/test/publish/publish-service.test.ts`** — the `RecordingGit` double. The publish-service only calls `commitFile`, so `commitFiles` just needs to exist and stay consistent. Route `commitFile` through a new `commitFiles` (so any recorded state stays correct), or, if simpler, add a `commitFiles` that applies changes to the same backing map + records, mirroring `commitFile`. Add `commitFiles` to the `RecordingGit` object and keep `commitFile`'s recording behavior intact (the message-assertion tests must still pass).

- [ ] **Step 11: Typecheck everything + run existing suites (delegation must preserve behavior)**

Run, expecting all PASS:
```
cd packages/core && pnpm typecheck && pnpm vitest run
cd packages/git-memory && pnpm typecheck && pnpm vitest run
cd packages/git-idb && pnpm typecheck && pnpm vitest run
cd packages/git-local && pnpm typecheck && pnpm vitest run
cd packages/git-http && pnpm typecheck && pnpm vitest run
cd packages/git-testing && pnpm typecheck && pnpm vitest run
cd apps/api && pnpm typecheck && pnpm vitest run
```
The existing `runGitPortContract` cases (commitFile, list, read) must still pass for all adapters — proving the `commitFile`→`commitFiles` delegation preserves behavior. If any inline `GitPort` double elsewhere fails typecheck, add `commitFiles` to it the same way.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(git): commitFiles capability across GitPort + 4 adapters + api route"
```

---

### Task 2: `commitFiles` contract cases + api route test + verification

**Files:**
- Modify: `packages/git-testing/src/index.ts` (`commitFiles` cases in `runGitPortContract`)
- Test: `apps/api/test/git-commit-files.test.ts` (the new route)

**Interfaces:**
- Consumes: `GitPort.commitFiles`, `FileChange` (Task 1); `createGitApi` + `createMemoryGitPort` for the route test.

- [ ] **Step 1: Add the contract cases**

In `packages/git-testing/src/index.ts`, inside `runGitPortContract`'s `describe`, after the existing commit tests, add:
```ts
    it('commitFiles writes multiple files in ONE commit', async () => {
      const { sha } = await port.commitFiles({
        changes: [{ path: 'a.mdoc', content: 'A' }, { path: 'b.mdoc', content: 'B' }],
        message: 'm', author,
      })
      expect(await port.headSha()).toBe(sha)
      expect(await port.readFile('a.mdoc')).toBe('A')
      expect(await port.readFile('b.mdoc')).toBe('B')
    })

    it('commitFiles deletes a file', async () => {
      await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
      await port.commitFiles({ changes: [{ path: 'a.mdoc', delete: true }], message: 'rm', author })
      expect(await port.readFile('a.mdoc')).toBeNull()
      expect(await port.list()).toEqual([])
    })

    it('commitFiles mixes a write and a delete in ONE commit', async () => {
      await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
      const { sha } = await port.commitFiles({
        changes: [{ path: 'a.mdoc', delete: true }, { path: 'b.mdoc', content: 'B' }],
        message: 'm2', author,
      })
      expect(await port.headSha()).toBe(sha)
      expect(await port.readFile('a.mdoc')).toBeNull()
      expect(await port.readFile('b.mdoc')).toBe('B')
    })

    it('commitFiles with empty changes makes no commit', async () => {
      const { sha: first } = await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
      const { sha } = await port.commitFiles({ changes: [], message: 'noop', author })
      expect(sha).toBe(first)
      expect(await port.headSha()).toBe(first)
    })

    it('commitFiles tolerates deleting an absent path (no commit)', async () => {
      const { sha: first } = await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
      const { sha } = await port.commitFiles({ changes: [{ path: 'ghost.mdoc', delete: true }], message: 'noop', author })
      expect(sha).toBe(first)
      expect(await port.readFile('a.mdoc')).toBe('A')
    })
```

- [ ] **Step 2: Run the contract for all four adapters (RED → GREEN proof)**

Run, expecting all PASS (Task 1 already implemented `commitFiles`):
```
cd packages/git-memory && pnpm vitest run
cd packages/git-idb && pnpm vitest run
cd packages/git-local && pnpm vitest run
cd packages/git-http && pnpm vitest run
cd packages/git-testing && pnpm vitest run
```
If any adapter fails a case, fix that adapter (the contract is the source of truth for behavior). Expected: every adapter passes the five new cases plus all existing ones.

- [ ] **Step 3: Write the api route test**

`apps/api/test/git-commit-files.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'

const author = { name: 'T', email: 't@x.com' }

describe('POST /git/commit-files', () => {
  it('commits writes + deletes in one request and reflects them', async () => {
    const app = createGitApi(createMemoryGitPort())
    // seed a file to delete
    await app.fetch(new Request('http://x/git/commit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'old.mdoc', content: 'OLD', message: 'm', author }),
    }))
    const res = await app.fetch(new Request('http://x/git/commit-files', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: [{ path: 'old.mdoc', delete: true }, { path: 'new.mdoc', content: 'NEW' }], message: 'batch', author }),
    }))
    expect(res.status).toBe(200)
    const { sha } = (await res.json()) as { sha: string }
    expect(typeof sha).toBe('string')
    const head = await (await app.fetch(new Request('http://x/git/head'))).json() as { sha: string }
    expect(head.sha).toBe(sha)
    const gone = await (await app.fetch(new Request('http://x/git/file?path=old.mdoc'))).json() as { content: string | null }
    expect(gone.content).toBeNull()
    const added = await (await app.fetch(new Request('http://x/git/file?path=new.mdoc'))).json() as { content: string | null }
    expect(added.content).toBe('NEW')
  })
})
```

- [ ] **Step 4: Run the api test**

Run: `cd apps/api && pnpm vitest run test/git-commit-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Whole-monorepo verification**

Run (repo root): `pnpm -r test`
Then for typecheck, generate Astro types first (pre-existing fresh-worktree need), then typecheck:
`pnpm --filter @setu/site exec astro sync && pnpm -r typecheck`
Expected: all packages PASS; typecheck clean. (If `apps/site` still fails, confirm the failure does not reference the git changes — it should be unrelated Astro content codegen.)

- [ ] **Step 6: Commit**

```bash
git add packages/git-testing/src/index.ts apps/api/test/git-commit-files.test.ts
git commit -m "test(git): commitFiles contract cases (all adapters) + api route test"
```

---

## Self-Review

**Spec coverage:**
- §1 types (`FileChange` union, `CommitFilesInput`) → Task 1 Steps 1, 3. ✓
- §2 `GitPort.commitFiles` + `commitFile` delegated → Task 1 Steps 2, 5–9. ✓
- §3 uniform semantics (one commit; net-empty no-op returns head; delete-absent tolerated; order/last-wins; root-escape check) → Task 1 adapters; verified Task 2 contract. ✓
- §4 per-adapter (memory/idb/local/http) + `@setu/api` route → Task 1 Steps 5–9. ✓
- §5 contract cases (multi-write, delete, mixed, empty no-op, delete-absent) → Task 2 Step 1. ✓
- Error handling (net-empty, delete-absent, root-escape, http non-2xx via existing `json()`) → Task 1 adapters + Task 2 contract. ✓
- Testing (contract all four; api route test) → Task 2. ✓
- Non-goals (bulk UI, category delete/slug-rename) → none built. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The read-service/publish-service double fixes (Step 10) describe the exact transform (delegate `commitFile` through a new `commitFiles`, preserve existing behavior) rather than pasting those files' full bodies — acceptable because the change is mechanical and the doubles' existing `commitFile` bodies are the template.

**Type consistency:** `FileChange`/`CommitFilesInput` consistent across types/interface/adapters/contract; `commitFiles({changes,message,author})` signature identical everywhere; `commitFile` delegates with `changes: [{ path, content }]` uniformly; `'delete' in ch` narrowing used consistently; net-empty returns `{ sha: head ?? '' }` in every adapter.
