# Design — GitPort + git-local adapter + contract suite (Increment #5)

_Date: 2026-06-14 · Status: approved_

## Purpose

Stand up Saytu's git seam: the **`GitPort` interface** (in `@setu/core`), a
reusable **GitPort contract suite** (`@setu/git-testing`), and a concrete
**`git-local`** adapter (isomorphic-git) that passes the contract. This is the
first slice of the "publish" direction — the read/commit primitives the publish
pipeline (increment #6) will orchestrate. Mirrors the increment-#3 pattern
(DataPort / db-sqlite / db-testing).

Follows a decision-complete PRD (`plan/prd.md` §1, §2, §15, §16) and shipped
increments #1–#4.

## Architecture refinement (recorded)

PRD §1 frames `GitPort` as an "edge-only seam" and §23 lists a single `git/`
package ("GitPort + GitHub adapter"). This design refines that to the **same
hexagonal shape as DataPort**: `GitPort` is one interface with **two adapters** —
`git-local` (real git for T1/T3, this increment) and `git-github` (GitHub HTTP
API for edge, a later increment). The publish service depends only on `GitPort`,
so it has one code path across topologies. This is consistent with §1's own
Ports-&-Adapters principle; the "edge-only" framing just explains *why* the
abstraction must exist (workerd has no git binary).

## Scope

**First GitPort slice = the read + commit primitives the publish pipeline needs.**

**In:**
- `@setu/core/src/git/`: the `GitPort` interface + types (`GitAuthor`,
  `CommitInput`). Pure, edge-portable; added to the core edge guard.
- `@setu/git-testing`: `runGitPortContract(makeAdapter)` — a Vitest battery any
  GitPort adapter runs; self-tested against an in-memory fake GitPort.
- `@setu/git-local`: `createLocalGitAdapter({ dir, fs? })` (isomorphic-git);
  passes the contract against a fresh temp-dir repo per test, plus one on-disk
  test.

**Out (explicitly deferred):**
- The publish **service** (draft → Markdoc → commit) + the base-SHA conflict
  guard — increment #6, in `@setu/core`, consuming GitPort + DataPort + the
  round-trip.
- The `git-github` (edge) adapter — runs this same contract later.
- The Git → DB **reindex** (needs the content-index DataPort slice deferred in #3).
- Remote **push/pull**, the deploy hook (§16), redirects, delete/move,
  multi-file atomic commits, history/diff, branches.
- The `.mdoc` file-path / permalink convention (an increment-#6 concern).

## Why these choices

- **Thin port (no base-SHA guard in the port).** `GitPort` exposes only
  `headSha` / `readFile` / `commitFile`. The §2 base-SHA conflict guard ("if HEAD
  moved for that file, block the commit") is *policy*, implemented in the #6
  publish service by reading `headSha`/`readFile` and comparing to the draft's
  recorded `baseSha`. Keeping the port thin matches the DataPort precedent.
- **isomorphic-git** for the local adapter (over `simple-git` / `child_process`):
  pure JS → **no git-binary dependency** (deterministic tests anywhere, no
  reliance on ambient `git config user.*`); **explicit author** params (a CMS
  sets the author to the editor, not the machine identity); standard git objects
  (real, pushable commits). Pure JS → no `onlyBuiltDependencies` entry needed.
- **Non-atomic read-then-commit** is accepted for V1 (single-writer T1/T3), the
  same tradeoff as the increment-#4 lock race. A guarded/CAS commit can come later.

## Architecture

```
packages/core/src/git/
├── types.ts          # GitAuthor, CommitInput
└── git-port.ts       # GitPort interface
(+ re-exported from packages/core/src/index.ts; src/git added to tsconfig.edge.json)

packages/git-testing/             # @setu/git-testing (private; vitest peer)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/index.ts                  # runGitPortContract(makeAdapter)
└── test/fake-git.test.ts         # self-test vs an in-memory fake GitPort

packages/git-local/               # @setu/git-local
├── package.json                  # isomorphic-git
├── tsconfig.json                 # types: ["node"]
├── vitest.config.ts
├── src/
│   ├── adapter.ts                # createLocalGitAdapter({ dir, fs? })
│   └── index.ts
└── test/
    ├── contract.test.ts          # runGitPortContract over a fresh temp-dir repo
    └── git-local.test.ts         # on-disk specifics
```

`GitPort` interface = pure types (edge-safe). `git-local` is Node-only
(isomorphic-git + `node:fs`/`node:path`) in its own package — not edge-guarded.

## Interface & types (`@setu/core`)

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

## Contract suite (`@setu/git-testing`)

`runGitPortContract(makeAdapter: () => Promise<GitPort> | GitPort): void` — each
test gets a FRESH adapter (a fresh empty repo) via `makeAdapter` in `beforeEach`.
No `close()` on `GitPort` (isomorphic-git is stateless per call), so no
`afterEach` teardown in the suite itself; adapters that allocate temp dirs clean
up in their own test's `afterEach`.

Assertions (adapter-agnostic):
- empty repo: `headSha()` → `null`; `readFile('x.mdoc')` → `null`.
- `commitFile` returns a `{ sha }` whose `sha` is a non-empty string; afterwards
  `headSha()` is non-null and equals that sha.
- after committing a file, `readFile(path)` returns the exact content.
- a second `commitFile` (same or different path) changes `headSha` to a new value
  and `readFile` reflects the latest content.
- nested paths (`'blog/sub/hello.mdoc'`) commit + read back (parent dirs created).
- `readFile` of a path that was never committed → `null`.

Self-test (`test/fake-git.test.ts`): a tiny in-memory `GitPort`
(`Map<string,string>` for files + an incrementing sha counter + a `head` ref)
run through `runGitPortContract` — proves the suite passes a correct
implementation (and would fail a broken one).

## git-local adapter

`createLocalGitAdapter({ dir, fs? }): GitPort` — operates on an **existing** git
repo at `dir` (the test/`makeAdapter` does `git.init` first; the adapter does not
own repo lifecycle). `fs` defaults to `node:fs`.

- `headSha()`: `git.resolveRef({ fs, dir, ref: 'HEAD' })`; the empty-repo throw is
  caught and mapped to `null`.
- `readFile(path)`: resolve HEAD (null → return null); `git.readBlob({ fs, dir,
  oid, filepath: path })` and decode; the not-found throw → `null`.
- `commitFile({ path, content, message, author })`: `mkdir -p` the parent,
  `fs.writeFile` the content, `git.add({ fs, dir, filepath: path })`,
  `git.commit({ fs, dir, message, author })`; return `{ sha }` (the commit oid).

`isomorphic-git` is a normal dependency (pure JS — no native build, no
`onlyBuiltDependencies` entry). `@types/node` devDep; tsconfig `types: ["node"]`.

## Error handling

- Reads of an empty repo / absent file return `null`, never throw (callers branch
  on null).
- `commitFile` propagates genuine git failures (e.g. a non-repo `dir`) — those are
  real errors, not a normal outcome. The #6 publish service adds retry/UX (§16).
- The adapter is the only writer in the Saytu model, so `readFile` reads the
  committed blob (HEAD), not arbitrary working-tree state.

## Testing (TDD)

- **`@setu/git-testing`**: the contract + the in-memory fake self-test (green
  proves the harness).
- **`@setu/git-local`**: `test/contract.test.ts` runs `runGitPortContract` where
  `makeAdapter` creates a fresh temp dir (`mkdtempSync`), `git.init({ defaultBranch:
  'main' })`, returns `createLocalGitAdapter({ dir })`, and the test's `afterEach`
  removes the temp dirs. `test/git-local.test.ts` adds an on-disk specific: commit
  a file, then a fresh adapter on the same dir reads it back (persistence) and
  `headSha` matches.
- Root `pnpm test` / `pnpm typecheck` stay green; the core edge guard now covers
  `src/git` (the interface must stay Node-free; isomorphic-git/node deps live only
  in `git-local`).

## Definition of done

- `pnpm install` clean (isomorphic-git added to `git-local`; no native build).
- `pnpm typecheck` clean across all packages incl. the core edge guard (now
  covering `src/git`).
- `pnpm test` green: `git-local` passes the full GitPort contract; `git-testing`
  self-test green; existing 80 tests unaffected.
- `GitPort` + types exported from `@setu/core`; `runGitPortContract` from
  `@setu/git-testing`; `createLocalGitAdapter` from `@setu/git-local`.
- Committed via the subagent-driven flow.
