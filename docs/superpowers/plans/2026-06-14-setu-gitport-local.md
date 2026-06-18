# GitPort + git-local + Contract Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Setu's git seam — the `GitPort` interface (in `@setu/core`), a reusable contract suite (`@setu/git-testing`), and an isomorphic-git `git-local` adapter that passes it — the read/commit primitives the publish pipeline will use.

**Architecture:** Pure `GitPort` interface + types in `@setu/core/src/git` (edge-portable, edge-guarded). `@setu/git-testing` exports `runGitPortContract(makeAdapter)`, self-tested against an in-memory fake GitPort. `@setu/git-local` implements the port with isomorphic-git over an existing repo; its tests `git.init` a temp-dir repo per case. Mirrors the increment-#3 DataPort/db-sqlite/db-testing shape.

**Tech Stack:** TypeScript (strict), isomorphic-git (pure JS — no native build), Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-14-setu-gitport-local-design.md`

---

## File Structure

```
packages/core/src/git/
├── types.ts          # GitAuthor, CommitInput
└── git-port.ts       # GitPort interface
packages/core/src/index.ts        # + re-export GitPort surface
packages/core/tsconfig.edge.json  # + "src/git" in include
packages/core/test/git/types.test.ts

packages/git-testing/             # @setu/git-testing (private)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/index.ts                  # runGitPortContract(makeAdapter)
└── test/fake-git.test.ts         # self-test vs in-memory fake GitPort

packages/git-local/               # @setu/git-local
├── package.json                  # isomorphic-git
├── tsconfig.json                 # types: ["node"]
├── vitest.config.ts
├── src/
│   ├── adapter.ts                # createLocalGitAdapter({ dir, fs? })
│   └── index.ts
└── test/
    ├── contract.test.ts          # runGitPortContract over a fresh temp-dir repo
    └── git-local.test.ts         # on-disk persistence
```

---

### Task 1: `GitPort` interface + types in `@setu/core`

**Files:**
- Create: `packages/core/src/git/types.ts`
- Create: `packages/core/src/git/git-port.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tsconfig.edge.json`
- Test: `packages/core/test/git/types.test.ts`

- [ ] **Step 1: Create the types**

Create `packages/core/src/git/types.ts`:

```ts
/** Identity stamped on a commit (the editor, not the machine's git config). */
export interface GitAuthor {
  name: string
  email: string
}

/** A single-file commit request. */
export interface CommitInput {
  /** Repo-relative path, e.g. 'content/blog/hello.mdoc'. */
  path: string
  content: string
  message: string
  author: GitAuthor
}
```

- [ ] **Step 2: Create the GitPort interface**

Create `packages/core/src/git/git-port.ts`:

```ts
import type { CommitInput } from './types'

/** The git seam: read published content + commit. Server topologies use a real
 *  local git adapter; edge uses a GitHub-API adapter (later). The DB is derived;
 *  Git is canonical for published content (§2). */
export interface GitPort {
  /** Current HEAD commit sha, or null if the repo has no commits yet. */
  headSha(): Promise<string | null>
  /** Content of `path` at HEAD, or null if it does not exist / no commits. */
  readFile(path: string): Promise<string | null>
  /** Write `path` and commit it; returns the new HEAD commit sha. */
  commitFile(input: CommitInput): Promise<{ sha: string }>
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/core/test/git/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { GitPort, GitAuthor, CommitInput } from '../../src/index'

describe('GitPort types', () => {
  it('GitAuthor / CommitInput shapes compile and carry expected fields', () => {
    const author: GitAuthor = { name: 'Ed', email: 'ed@x.com' }
    const input: CommitInput = { path: 'a.mdoc', content: 'x', message: 'm', author }
    expect([input.path, input.author.email]).toEqual(['a.mdoc', 'ed@x.com'])
  })

  it('GitPort is structurally implementable', () => {
    const stub: Pick<GitPort, 'headSha'> = { headSha: async () => null }
    expect(typeof stub.headSha).toBe('function')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- git/types`
Expected: FAIL — types not exported from `../../src/index`.

- [ ] **Step 5: Export the git surface from the package index**

Edit `packages/core/src/index.ts` — append:

```ts
export type { GitAuthor, CommitInput } from './git/types'
export type { GitPort } from './git/git-port'
```

- [ ] **Step 6: Add `src/git` to the edge-portability guard**

Edit `packages/core/tsconfig.edge.json` — change the `include` array to:

```json
  "include": ["src/markdoc", "src/data", "src/authoring", "src/git"]
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- git/types`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck (incl. edge guard)**

Run: `pnpm --filter @setu/core typecheck`
Expected: clean — both the main check and the edge guard (the GitPort interface is pure, Node-free).

- [ ] **Step 9: Run the full core suite**

Run: `pnpm --filter @setu/core test`
Expected: PASS — 59 tests (57 prior + 2 new).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/git packages/core/src/index.ts packages/core/tsconfig.edge.json packages/core/test/git
git commit -m "feat(core): GitPort interface + GitAuthor/CommitInput types"
```

---

### Task 2: `@setu/git-testing` — contract suite + in-memory fake self-test

**Files:**
- Create: `packages/git-testing/package.json`
- Create: `packages/git-testing/tsconfig.json`
- Create: `packages/git-testing/vitest.config.ts`
- Create: `packages/git-testing/src/index.ts`
- Create: `packages/git-testing/test/fake-git.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/git-testing/package.json`:

```json
{
  "name": "@setu/git-testing",
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
    "@setu/core": "workspace:*"
  },
  "peerDependencies": {
    "vitest": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/git-testing/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": [] },
  "include": ["src", "test"]
}
```

Create `packages/git-testing/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 2: Install (links the workspace deps)**

Run: `pnpm install`
Expected: clean; `@setu/core` symlinked into the new package.

- [ ] **Step 3: Implement the contract suite**

Create `packages/git-testing/src/index.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { GitPort } from '@setu/core'

const author = { name: 'Test', email: 'test@x.com' }

/** Run the GitPort behavioral contract against an adapter. `makeAdapter` must
 *  return a FRESH adapter on an empty repo each call. */
export function runGitPortContract(makeAdapter: () => Promise<GitPort> | GitPort): void {
  describe('GitPort contract', () => {
    let port: GitPort
    beforeEach(async () => {
      port = await makeAdapter()
    })

    it('reports null head and null reads on an empty repo', async () => {
      expect(await port.headSha()).toBeNull()
      expect(await port.readFile('x.mdoc')).toBeNull()
    })

    it('commits a file and returns a string sha that becomes HEAD', async () => {
      const { sha } = await port.commitFile({ path: 'a.mdoc', content: 'A', message: 'm', author })
      expect(typeof sha).toBe('string')
      expect(sha.length).toBeGreaterThan(0)
      expect(await port.headSha()).toBe(sha)
    })

    it('reads back committed content; null for an uncommitted path', async () => {
      await port.commitFile({ path: 'a.mdoc', content: 'hello', message: 'm', author })
      expect(await port.readFile('a.mdoc')).toBe('hello')
      expect(await port.readFile('missing.mdoc')).toBeNull()
    })

    it('a second commit advances HEAD and reflects the latest content', async () => {
      const first = await port.commitFile({ path: 'a.mdoc', content: 'v1', message: 'm1', author })
      const second = await port.commitFile({ path: 'a.mdoc', content: 'v2', message: 'm2', author })
      expect(second.sha).not.toBe(first.sha)
      expect(await port.headSha()).toBe(second.sha)
      expect(await port.readFile('a.mdoc')).toBe('v2')
    })

    it('commits and reads nested paths (parent dirs created)', async () => {
      await port.commitFile({ path: 'blog/sub/hello.mdoc', content: 'nested', message: 'm', author })
      expect(await port.readFile('blog/sub/hello.mdoc')).toBe('nested')
    })
  })
}
```

- [ ] **Step 4: Write the self-test (in-memory fake GitPort)**

Create `packages/git-testing/test/fake-git.test.ts`:

```ts
import { runGitPortContract } from '../src/index'
import type { GitPort } from '@setu/core'

/** A correct in-memory GitPort — proves the contract passes a valid
 *  implementation (and would fail a broken one). */
function createFakeGit(): GitPort {
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
    async commitFile({ path, content }) {
      files.set(path, content)
      head = `fakesha${++counter}`
      return { sha: head }
    },
  }
}

runGitPortContract(() => createFakeGit())
```

- [ ] **Step 5: Run the self-test**

Run: `pnpm --filter @setu/git-testing test`
Expected: PASS — the full GitPort contract (5 tests) green against the fake.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @setu/git-testing typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/git-testing pnpm-lock.yaml
git commit -m "feat(git-testing): runGitPortContract + in-memory fake GitPort"
```

---

### Task 3: `@setu/git-local` — isomorphic-git adapter passing the contract

**Files:**
- Create: `packages/git-local/package.json`
- Create: `packages/git-local/tsconfig.json`
- Create: `packages/git-local/vitest.config.ts`
- Create: `packages/git-local/src/adapter.ts`
- Create: `packages/git-local/src/index.ts`
- Test: `packages/git-local/test/contract.test.ts`
- Test: `packages/git-local/test/git-local.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/git-local/package.json`:

```json
{
  "name": "@setu/git-local",
  "version": "0.0.0",
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
    "@setu/core": "workspace:*"
  },
  "devDependencies": {
    "@setu/git-testing": "workspace:*",
    "@types/node": "^22.10.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/git-local/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

Create `packages/git-local/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 2: Add isomorphic-git**

Run: `pnpm --filter @setu/git-local add isomorphic-git`
Expected: resolves and installs (pure JS — no native build; no `onlyBuiltDependencies` entry needed). isomorphic-git ships its own type declarations.

- [ ] **Step 3: Write the failing contract test**

Create `packages/git-local/test/contract.test.ts`:

```ts
import { afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { runGitPortContract } from '@setu/git-testing'
import { createLocalGitAdapter } from '../src/index'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

runGitPortContract(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
  dirs.push(dir)
  await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
  return createLocalGitAdapter({ dir })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @setu/git-local test -- contract`
Expected: FAIL — `createLocalGitAdapter` not exported / module missing.

- [ ] **Step 5: Implement the adapter**

Create `packages/git-local/src/adapter.ts`:

```ts
import nodeFs from 'node:fs'
import { dirname, join } from 'node:path'
import * as git from 'isomorphic-git'
import type { GitPort } from '@setu/core'

export interface LocalGitOptions {
  /** Path to an existing git repository (the caller/test runs `git init`). */
  dir: string
  /** Filesystem implementation; defaults to node:fs. */
  fs?: typeof nodeFs
}

/** True when an isomorphic-git error means "not found" (unborn HEAD / absent
 *  filepath) — the expected "absent" signal we map to null. */
const isNotFound = (e: unknown): boolean =>
  e instanceof Error && (e as { code?: string }).code === 'NotFoundError'

/** A GitPort backed by a real local git repo via isomorphic-git (T1/T3). */
export function createLocalGitAdapter(options: LocalGitOptions): GitPort {
  const fs = options.fs ?? nodeFs
  const dir = options.dir

  const headSha = async (): Promise<string | null> => {
    try {
      return await git.resolveRef({ fs, dir, ref: 'HEAD' })
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  return {
    headSha,
    async readFile(path) {
      const oid = await headSha()
      if (oid === null) return null
      try {
        const { blob } = await git.readBlob({ fs, dir, oid, filepath: path })
        return new TextDecoder().decode(blob)
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    async commitFile({ path, content, message, author }) {
      const full = join(dir, path)
      await fs.promises.mkdir(dirname(full), { recursive: true })
      await fs.promises.writeFile(full, content, 'utf8')
      await git.add({ fs, dir, filepath: path })
      const sha = await git.commit({
        fs,
        dir,
        message,
        author: { name: author.name, email: author.email },
      })
      return { sha }
    },
  }
}
```

- [ ] **Step 6: Create the package entry**

Create `packages/git-local/src/index.ts`:

```ts
export { createLocalGitAdapter } from './adapter'
export type { LocalGitOptions } from './adapter'
```

- [ ] **Step 7: Run the contract test**

Run: `pnpm --filter @setu/git-local test -- contract`
Expected: PASS — the full GitPort contract (5 tests) green against the local adapter.

Note: if the installed isomorphic-git version reports the "not found" error with a
different `.code`/class, or `git.commit` requires an explicit `author.timestamp`,
adapt MINIMALLY (keep: expected-absent → null, real errors propagate; commit
returns the oid). Note any deviation in the report.

- [ ] **Step 8: Write the on-disk persistence test**

Create `packages/git-local/test/git-local.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '../src/index'

describe('git-local adapter (on-disk)', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('persists a commit readable by a fresh adapter on the same repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })

    const a = createLocalGitAdapter({ dir })
    const { sha } = await a.commitFile({
      path: 'content/hello.mdoc',
      content: '# Hi',
      message: 'add hello',
      author: { name: 'Ed', email: 'ed@x.com' },
    })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    // A fresh adapter on the same repo sees the committed state.
    const b = createLocalGitAdapter({ dir })
    expect(await b.headSha()).toBe(sha)
    expect(await b.readFile('content/hello.mdoc')).toBe('# Hi')
  })
})
```

- [ ] **Step 9: Run the package suite + typecheck**

Run: `pnpm --filter @setu/git-local test`
Expected: PASS — 6 tests (5 contract + 1 on-disk).

Run: `pnpm --filter @setu/git-local typecheck`
Expected: clean.

- [ ] **Step 10: Full repo verification (definition of done)**

Run: `pnpm test && pnpm typecheck`
Expected: every package green — `@setu/core` 59, `@setu/db-testing` 11, `@setu/db-sqlite` 12, `@setu/git-testing` 5, `@setu/git-local` 6 (= 93 total); typecheck clean across all packages incl. the core edge guard (now covering `src/git`).

- [ ] **Step 11: Commit**

```bash
git add packages/git-local/package.json packages/git-local/tsconfig.json packages/git-local/vitest.config.ts packages/git-local/src packages/git-local/test pnpm-lock.yaml
git commit -m "feat(git-local): isomorphic-git GitPort adapter passing the shared contract"
```

---

## Self-Review

**Spec coverage:**
- `GitPort` interface (`headSha`/`readFile`/`commitFile`) + `GitAuthor`/`CommitInput` in `@setu/core/src/git` → Task 1. ✓
- Edge guard covers `src/git`; interface Node-free → Task 1 Steps 6, 8. ✓
- `@setu/git-testing` exporting `runGitPortContract`; self-tested vs in-memory fake → Task 2. ✓
- vitest as peerDependency in git-testing (matches db-testing) → Task 2 Step 1. ✓
- `@setu/git-local` with `createLocalGitAdapter({ dir, fs? })` (isomorphic-git, operates on an existing repo) passing the contract → Task 3. ✓
- isomorphic-git pure JS, no native build / no onlyBuiltDependencies entry → Task 3 Step 2. ✓
- Contract assertions: empty-repo null head + null read; commit→string sha = HEAD; read-back + null-for-absent; second commit advances HEAD + latest content; nested paths → Task 2 Step 3. ✓
- On-disk persistence (fresh adapter reads prior commit; sha is a 40-hex oid) → Task 3 Step 8. ✓
- Existing 80 tests stay green; core edge guard stays clean → Task 1 Step 9, Task 3 Step 10. ✓
- Deferred (publish service, base-SHA guard, git-github/edge, reindex, push, redirects, delete/move) → no task, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases". The isomorphic-git version-adaptation note (Task 3 Step 7) gives the exact invariant to preserve + a concrete fallback (timestamp), not a vague placeholder. ✓

**Type consistency:** `GitPort` (`headSha(): Promise<string|null>`, `readFile(path): Promise<string|null>`, `commitFile(CommitInput): Promise<{sha:string}>`) is defined in Task 1 and implemented identically by the fake (Task 2) and the local adapter (Task 3); both consume `CommitInput`/`GitAuthor`. `createLocalGitAdapter({ dir, fs? }): GitPort` and `runGitPortContract(makeAdapter)` signatures match their call sites. The fake and the adapter both return `{ sha }` from `commitFile` and map empty/absent to `null`. ✓
