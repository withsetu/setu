# Design — Publish Service (`@setu/core`) (Increment #6)

_Date: 2026-06-14 · Status: approved_

## Purpose

The keystone of the publish direction: a pure core service that turns a DB draft
into a committed Markdoc file in Git. It ties together five prior increments —
the round-trip (#1, `tiptapToMarkdoc`), the config model (#2), DataPort + drafts
(#3), the draft `baseSha` (#4), and GitPort (#5) — into the actual
**Draft → Staged** flow of PRD §2/§16.

Pure orchestration: injected `DataPort` + `GitPort`, no UI, no Node, no I/O of its
own. Follows a decision-complete PRD (§2, §4, §16) and shipped increments #1–#5.

## Scope

**In:**
- `packages/core/src/publish/`:
  - `content-path.ts` — pure `contentPath(ref): string`.
  - `publish-service.ts` — `createPublishService({ data, git })` with `publish(...)`.
  - `types.ts` — `PublishInput`, `PublishDeps`, `PublishResult`.
- Export the service + `contentPath` + types from `@setu/core`.
- Add `src/publish` to the core edge guard (`tsconfig.edge.json`).
- Vitest tests with local fake `DataPort` + fake `GitPort`.

**Out (explicitly deferred):**
- **File-level conflict precision** (§2 "if HEAD moved for *that file*") and the
  **fork-from-Git read flow** that records a draft's per-file base — they are
  coupled and neither exists yet. This increment ships the safe HEAD-level guard.
- The **Git → DB reindex** hook (needs the deferred content-index DataPort slice).
- The **deploy hook** and the Draft→Staged→Deployed status surface (§16).
- **Redirects** on slug/permalink change (§4), and configurable permalink/path.
- **Publish authorization** (the Publisher role) — upstream (AuthPort/the API).
- **Lock coordination** — the publish service does not read/touch locks; the
  authoring lock service (#4) and a higher flow coordinate that.
- The **`git-github` edge adapter** (publish runs against any `GitPort`).

## Why these choices

- **HEAD-level base-SHA guard (coarse but safe).** The cardinal rule is *never
  silently overwrite an external commit*. The guard blocks a publish when the
  repo HEAD moved since the draft's `baseSha`. This is exact within a single
  editor's session (each publish advances `baseSha`, so the next check is precise)
  and only over-blocks across *concurrent* editors — which the read/fork flow
  doesn't support yet anyway. File-level precision needs a `GitPort` readFile-at-ref
  extension **and** the fork-from-Git flow to record the per-file base; both are
  deferred together. Coarse-and-safe now beats precise-but-premature.
- **Keep the draft; advance its `baseSha` to the new commit.** After a successful
  publish the draft persists as the working copy (the editor keeps editing) and
  its `baseSha` now points at the just-created commit, so the *next* publish's
  conflict check is correct. A "delete the draft" model would strand the editor,
  because reading content back from Git (reindex) does not exist yet.
- **Fixed path convention `content/<collection>/<locale>/<slug>.mdoc`.** Encodes
  the full `(collection, locale, slug)` identity so paths are unique. Configurable
  permalinks/paths (§4) are a later concern; `contentPath` is exported so the
  editor/reindex can reuse the same mapping.
- **No clock dependency.** Publish needs no time of its own; the commit timestamp
  is the GitPort adapter's concern.

## Architecture

```
packages/core/src/publish/
├── types.ts            # PublishInput, PublishDeps, PublishResult
├── content-path.ts     # contentPath(ref): string  (pure)
└── publish-service.ts  # createPublishService(deps): { publish }
(+ re-exported from packages/core/src/index.ts; src/publish added to tsconfig.edge.json)
```

The service depends only on the `DataPort` + `GitPort` interfaces and the pure
`tiptapToMarkdoc` — no Node, no concrete adapter. Edge-portable; added to the
edge guard.

## Types & API

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

export function createPublishService(deps: PublishDeps): PublishService
```

`contentPath`:

```ts
import type { EntryRef } from '../data/types'

/** Repo-relative path for an entry's Markdoc file:
 *  `content/<collection>/<locale>/<slug>.mdoc`. */
export function contentPath(ref: EntryRef): string {
  return `content/${ref.collection}/${ref.locale}/${ref.slug}.mdoc`
}
```

## Behavior (publish)

1. `draft = await data.getDraft(ref)`. If `null` → `{ status: 'nothing' }`.
2. `head = await git.headSha()`.
3. **Guard:** if `draft.baseSha !== null && head !== null && draft.baseSha !== head`
   → `{ status: 'conflict', baseSha: draft.baseSha, headSha: head }` (no commit).
   - `baseSha === null` (fresh draft / first publish) → no conflict.
   - `head === null` (empty repo) → no conflict (this is the first commit).
4. `content = tiptapToMarkdoc(draft.content)`; `path = contentPath(ref)`.
5. `{ sha } = await git.commitFile({ path, content, message: message ??
   ``Publish ${ref.collection}/${ref.locale}/${ref.slug}``, author })`.
6. Advance the draft base: `await data.saveDraft({ collection, locale, slug,
   content: draft.content, metadata: draft.metadata, baseSha: sha })`.
7. → `{ status: 'published', sha, path }`.

## Error handling

- No draft → `nothing` (not an error).
- HEAD moved → `conflict` result (not a throw); nothing is written. The UI shows
  the §2 reload flow.
- `GitPort.commitFile` failures (dead remote, etc.) propagate — they are real
  failures; the adapter (#5) already makes a failed commit non-destructive +
  retryable (§16). The draft is untouched on a thrown commit (step 6 only runs
  after a successful commit), so a retry is safe.
- `DataPort`/`GitPort` errors propagate.

## Testing (TDD)

Local fakes in the test file (no cross-package dependency / workspace cycle): a
Map-based `DataPort` (the full interface) and an in-memory `GitPort` (files Map +
incrementing sha + head ref, like `@setu/git-testing`'s fake).

- **`content-path`** — `contentPath({post,en,hello})` === `content/post/en/hello.mdoc`;
  locale/collection are reflected (`fr` and `page` produce distinct paths).
- **publish — nothing:** no draft for `ref` → `{ status: 'nothing' }`; git untouched
  (headSha still null).
- **publish — first publish:** a draft with `baseSha: null` → `{ status:
  'published', sha, path }`; `path === contentPath(ref)`; the committed file
  (`git.readFile(path)`) equals `tiptapToMarkdoc(draft.content)`; the draft's
  `baseSha` is advanced to `sha` (`getDraft(ref).baseSha === sha`).
- **publish — republish (no false conflict):** after a first publish (baseSha now
  = head), edit + `saveDraft`, publish again → `published`, a new sha, baseSha
  advances again.
- **publish — conflict:** seed git so `head` is some sha, set the draft's
  `baseSha` to a *different* sha → `{ status: 'conflict', baseSha, headSha }`; the
  committed file is unchanged (nothing written) and the draft's `baseSha` is NOT
  advanced.
- **publish — custom message** is passed through to `commitFile` (assert via a
  fake that records the message); default message used when omitted.

## Definition of done

- `pnpm test` green: new publish suites + existing 97 unaffected.
- `pnpm typecheck` clean across packages incl. the edge guard now covering
  `src/publish` (the service must stay Node-free).
- `createPublishService`, `contentPath`, and the publish types exported from
  `@setu/core`.
- Committed via the subagent-driven flow.
