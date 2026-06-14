# Design — Read / Fork-from-Git Service (`@saytu/core`) (Increment #7)

_Date: 2026-06-14 · Status: approved_

## Purpose

Close the **content** half of the bidirectional loop. The backend can publish
(Tiptap → Markdoc → Git, #6) but cannot read published content back. This adds the
**fork-from-Git read path**: when an entry has no live DB draft, read its
published `.mdoc` from Git, convert it with `markdocToTiptap` (#1), and seed a
draft recording `baseSha = HEAD`. This proves the round-trip end-to-end through
real Git and is the prerequisite for a useful editor (open + edit + republish an
existing entry).

Pure core orchestration: injected `DataPort` + `GitPort`, edge-portable. Follows a
decision-complete PRD (§2, §9) and shipped increments #1–#6.

## Scope decomposition (recorded)

"Close the loop" is **two** tight increments, split by what round-trips:
- **#7 (this one): the *content* loop** — fork-from-Git for the Markdoc **body**.
- **#8 (next): the *metadata* loop** — metadata ↔ YAML frontmatter on publish +
  open. Deferred because it has its own complexity (a YAML dependency and
  frontmatter **round-trip idempotency**, the same class of concern that needed a
  spike for Markdoc). A forked draft gets `metadata: {}` until #8.

Both are needed before a complete editor; shipping them separately keeps each
tight and well-reviewed.

## Scope

**In:**
- A new `src/read/` module in `@saytu/core`:
  - `types.ts` — `LoadResult`, `ReadDeps`, `ReadService`.
  - `read-service.ts` — `createReadService({ data, git }).loadForEdit(ref)`.
- Export the service + types from `@saytu/core`.
- Add `src/read` to the core edge guard.
- Vitest tests with local fake `DataPort` + fake `GitPort`, including a
  publish → open → republish content round-trip through Git.

**Out (explicitly deferred):**
- **Metadata ↔ YAML frontmatter** (#8). Forked drafts get `metadata: {}`.
- **File-level base-SHA conflict precision.** #7 *unblocks* it (the fork now
  records a real `baseSha`), but using it needs a `GitPort` readFile-at-ref
  extension + a publish-guard refinement — a focused follow-on. The coarse
  HEAD-level guard (#6) stays and is now meaningful.
- **Full Git → DB reindex** (needs the content-index DataPort slice deferred in
  #3). The `read` module is its future home (a read-only `readPublished` for
  rendering/index later).
- **Config-driven `knownBlockTags`.** `markdocToTiptap(published)` uses the
  default set (callout); config wiring comes with the editor/config integration.
- **Lock coordination.** The read service does not touch locks; the editor/API
  composes it with the authoring service (#4).

## Why a separate service (not an `open()` extension)

The authoring service (#4) is pure `DataPort` + clock, edge-tested with a fake
`DataPort` and **no Git**. Folding Git-reading into `authoring.open()` would couple
it to `GitPort` and merge two concerns (locking vs content materialization).
Instead the editor/API **composes** the two primitives:

```
reader.loadForEdit(ref)   // ensure an editable draft exists (fork from Git if needed)
authoring.open(ref, editor)  // acquire the lock; returns the now-existing draft
```

`loadForEdit` persists the forked draft, so the subsequent `authoring.open` finds
it via `getDraft`. Clean seam; both stay single-responsibility.

## Architecture

```
packages/core/src/read/
├── types.ts          # LoadResult, ReadDeps, ReadService
└── read-service.ts   # createReadService(deps): { loadForEdit }
(+ re-exported from packages/core/src/index.ts; src/read added to tsconfig.edge.json)
```

Depends only on `DataPort` + `GitPort` interfaces, `markdocToTiptap` (pure), and
`contentPath` (pure, from `src/publish`). No Node — edge-portable.

## Types & API

```ts
import type { EntryRef, Draft } from '../data/types'
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

export function createReadService(deps: ReadDeps): ReadService
```

## Behavior (loadForEdit)

1. `existing = await data.getDraft(ref)`. If non-null → `{ source: 'draft',
   draft: existing }` (a live WIP draft always wins — never re-fork over edits).
2. `published = await git.readFile(contentPath(ref))`. If `null` → `{ source:
   'absent' }` (no draft, not published).
3. Otherwise materialize:
   - `content = markdocToTiptap(published)` (Git → Tiptap — the read half of #1;
     default `knownBlockTags`).
   - `head = await git.headSha()`.
   - `draft = await data.saveDraft({ ...ref, content, metadata: {}, baseSha: head })`.
   - → `{ source: 'forked', draft }`.

The forked draft's `baseSha = head` makes the publish conflict guard (#6)
meaningful: a later edit + republish correctly detects whether the repo moved
since this fork.

## Error handling

- Absent entry → `{ source: 'absent' }` (not an error).
- `GitPort.readFile` / `DataPort` errors propagate (real failures).
- `markdocToTiptap` never throws and never drops content (the #1 guarantee), so a
  malformed published file forks into a draft with the malformed content preserved
  as a flagged passthrough — consistent with the round-trip's contract.

## Testing (TDD)

Local fakes in the test file (no cross-package cycle): a Map-based `DataPort`
(full interface) and an in-memory `GitPort` (files Map + sha counter + head).

- **existing draft wins:** seed a DB draft for `ref`; `loadForEdit` → `{ source:
  'draft' }` with that draft; assert no fork happened (git not read into a new
  draft — the returned draft is the seeded one, unchanged).
- **forked from Git:** commit a `.mdoc` at `contentPath(ref)` (no DB draft);
  `loadForEdit` → `{ source: 'forked' }`; the draft's `content` equals
  `markdocToTiptap(published)`, `metadata` is `{}`, and `baseSha` equals the
  current HEAD; the draft is persisted (`getDraft(ref)` now returns it).
- **absent:** no draft, nothing published → `{ source: 'absent' }`.
- **content round-trip through Git (the headline test):** start from a Tiptap doc,
  `tiptapToMarkdoc` → commit via the fake GitPort at `contentPath(ref)`, then
  `loadForEdit` → the forked draft's `content`, re-serialized with
  `tiptapToMarkdoc`, equals the published Markdoc (body survives publish → open).

## Definition of done

- `pnpm test` green: new read suite + existing 106 unaffected.
- `pnpm typecheck` clean across packages incl. the edge guard now covering
  `src/read` (the service must stay Node-free).
- `createReadService` + `LoadResult`/`ReadDeps`/`ReadService` exported from
  `@saytu/core`.
- Committed via the subagent-driven flow.
