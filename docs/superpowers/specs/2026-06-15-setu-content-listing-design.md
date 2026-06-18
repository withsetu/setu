# Design — Git content listing / reindex

_Date: 2026-06-15 · Status: approved (converged in UAT discussion)_

## Purpose

Close the hole where **published content disappears from the admin**: today the
content list (and `deploy()`) enumerate the world via `data.listDrafts()`, so an
entry that was published and whose draft is gone lives only in Git and is
invisible — you can't list it, open it, or deploy it. Git is canonical for
published content (§2) but `GitPort` can only `readFile(path)` if you already know
the path; it can't answer "what entries exist?".

This increment adds the missing **enumeration primitive** to `GitPort`, plus a
pure **content-index derivation** in core that merges Git entries with DB drafts
into one list, each with its true derived lifecycle status. This is the
foundational **reindex** primitive the topology note
(`2026-06-14-setu-topology-publishing-note.md`) points at: "reindex must be
idempotent + derivable purely from Git." The same primitive also fixes `deploy()`.

## Root cause (the thing we're fixing)

`ContentList` and `DeployProvider.deploy()` both derive "all entries" from
`data.listDrafts()` — the DB draft store. Published-but-no-draft entries exist
only as committed `.mdoc` files in Git, which nothing enumerates. One missing
capability (enumerate Git) causes two bugs (can't list, can't deploy them).

## Scope

**In:**

1. **Enumeration primitive** — `GitPort.list(prefix?)`: returns the repo-relative
   paths of all files at HEAD, optionally filtered to those under `prefix`. Empty
   array when the repo has no commits. Implemented in **both** adapters
   (`git-memory`, `git-local`) and proven by the shared `runGitPortContract`.
2. **Reverse path parse** — pure `parseContentPath(path): EntryRef | null` in core
   (the inverse of `contentPath`): maps
   `content/<collection>/<locale>/<slug>.mdoc` → `EntryRef`, returns `null` for
   any path that doesn't match (non-content files are ignored).
3. **Content-index derivation** — pure core `listContentEntries({ drafts,
   committed, deployedAt })` → `ContentRow[]`: merges drafts with committed Git
   entries keyed by entry identity (an entry with both yields **one** row; the
   draft is the editable source), computes each row's **derived lifecycle** via the
   existing `deriveLifecycle`, and carries the fields the list renders. Pure,
   edge-safe, unit-tested — the reindex primitive.
4. **Content list wiring** — `ContentList` gathers inputs (`git.list` +
   `readFile` for the collection, `data.listDrafts({collection})`) and renders the
   merged rows. Git-only rows show their real status pill (Staged/Live/…); clicking
   any row opens the editor (drafts directly; Git-only entries **fork a draft from
   Git** on open via the existing `loadForEdit` → `forked` path — no new screen).
5. **Deploy fix** — `deploy()` enumerates the working set via `git.list('content/')`
   instead of `data.listDrafts()`, so published-only entries are snapshotted and go
   Live like any other.

**Out (deferred):**

- A real DB **index table** (Git → DataPort index rows; the heavy SSR-shaped
  reindex with a write path + invalidation). The topology note files this under
  deferred (SSR). Approach A here is the foundation it would build on.
- **Read-only preview** of published content before editing — a separate feature;
  fork-on-open is the agreed model.
- A true **"last modified" timestamp** for Git-only entries — our in-browser Git
  has no commit dates (the sha isn't a date). Git-only rows show "—" (see Updated
  column below). Real commit metadata is a later concern.
- Batched tree reads — `list()` + per-path `readFile` is correct; a single
  tree-walk read is a perf optimization, not needed at demo scale.
- Pagination / search / sort of the list.

## Architecture / data flow

```
packages/core/src/git/git-port.ts        # + list(prefix?): Promise<string[]>
packages/core/src/publish/content-path.ts # + parseContentPath(path): EntryRef | null
packages/core/src/content-index/          # NEW (pure, edge-safe)
└── list-entries.ts   # listContentEntries({drafts, committed, deployedAt}) -> ContentRow[]
packages/git-memory/src/adapter.ts        # implement list() over the Map
packages/git-local/src/adapter.ts         # implement list() via git.listFiles at HEAD
packages/git-testing (runGitPortContract) # + list() contract cases
apps/admin/src/
├── screens/ContentList.tsx   # gather git.list + drafts -> listContentEntries -> render
└── deploy/deploy.tsx         # deploy() enumerates via git.list('content/')
```

### `GitPort.list`

```ts
/** Repo-relative paths of all files at HEAD, filtered to those under `prefix`
 *  (default: all). Empty when the repo has no commits. Order is not guaranteed. */
list(prefix?: string): Promise<string[]>
```

- **git-memory:** the keys of the backing `Map`, filtered by `prefix` (`path ===
  prefix || path.startsWith(prefix)` — prefix is treated as a literal path prefix,
  callers pass a trailing `/` like `content/post/`).
- **git-local:** `git.listFiles({ fs, dir, ref: 'HEAD' })` filtered by `prefix`;
  unborn HEAD (no commits) → `[]` (map the isomorphic-git NotFound the same way
  `readFile`/`headSha` already do).

### `parseContentPath`

Inverse of `contentPath`. Matches `content/<collection>/<locale>/<slug>.mdoc`
where the three segments contain no `/`. Returns `EntryRef` or `null`.

```ts
export function parseContentPath(path: string): EntryRef | null
```

### `listContentEntries` (pure)

```ts
export interface ContentRow {
  ref: EntryRef
  title: string             // draft.metadata.title ?? committed frontmatter.title ?? slug
  locale: string
  lifecycle: Lifecycle      // from deriveLifecycle
  updatedAt: number | null  // draft.updatedAt; null for Git-only entries
  hasDraft: boolean
}

export function listContentEntries(input: {
  drafts: Draft[]
  committed: { ref: EntryRef; content: string }[]
  deployedAt: (path: string) => string | null
}): ContentRow[]
```

Derivation per entry (union of refs from drafts + committed, deduped by
`collection/locale/slug`):
- `draftStr = draft ? serializeMdoc({ frontmatter: draft.metadata, body:
  tiptapToMarkdoc(draft.content) }) : null`
- `committedStr = committed-for-ref ?? null`
- `deployedStr = deployedAt(contentPath(ref))`
- `lifecycle = deriveLifecycle({ draft: draftStr, committed: committedStr, deployed:
  deployedStr })`
- `title` = `draft?.metadata.title` else `parseMdoc(committedStr).frontmatter.title`
  else `ref.slug`
- `updatedAt` = `draft?.updatedAt ?? null`
- `hasDraft` = `draft != null`

This reuses the exact composition `lifecycleFor` does today, generalized to "all
refs" instead of "one draft." `lifecycleFor` may be refactored to delegate, or left
as-is; the list uses `listContentEntries`.

## Updated column

- **Draft rows:** `new Date(updatedAt).toLocaleDateString()` (unchanged).
- **Git-only rows (`updatedAt === null`):** render **"—"**. Honest — we have no
  modified time yet; we do not fake one from frontmatter. (Decision: option 1.)

## Error handling / edge cases

- **No commits yet** → `git.list()` returns `[]`; the list shows drafts only (or the
  existing empty state). No throw.
- **Non-content files in Git** (e.g. `setu.config.ts`, future assets) →
  `parseContentPath` returns `null` and they're skipped; only `content/**.mdoc` rows
  appear.
- **Entry with both draft and commit** → one row; the draft is the identity holder
  and the editable source. Lifecycle still reflects committed/deployed via
  `deriveLifecycle` (e.g. `Live · edited`).
- **Deploy of a published-only entry** → now included in the snapshot; its status
  flips to Live like a draft-backed entry.
- **Collection filtering** → the list passes `prefix = 'content/<collection>/'` to
  `git.list` and `{collection}` to `listDrafts`, so a page never leaks the other
  collection's entries.

## Testing (behavior)

- **`GitPort.list` contract** (runs against both adapters via `runGitPortContract`):
  empty repo → `[]`; after committing files → they appear; `prefix` filters to the
  matching subtree; a path outside the prefix is excluded.
- **git-memory seed** → `list()` returns seeded paths.
- **`parseContentPath`:** valid content path → correct `EntryRef`; a non-matching
  path (`setu.config.ts`, a path with extra segments, wrong extension) → `null`;
  round-trips with `contentPath`.
- **`listContentEntries` (pure unit, a table):** draft-only → one row, status from
  derive; committed-only → one row, title from frontmatter, `updatedAt: null`,
  `hasDraft: false`; both present → one row, `hasDraft: true`, lifecycle reflects
  ahead/behind; deployed committed-only → `live`; collections/refs deduped; title
  falls back slug.
- **`ContentList` (mocked services):** renders a merged list including a Git-only
  entry with the right status pill and "—" in Updated; clicking a Git-only row
  navigates to `/edit/...`; existing draft rows unchanged.
- **`deploy()`:** snapshots a published-only entry (no draft) → its row flips to
  Live.
- Existing core/db/git suites + admin tests stay green. `verbatimModuleSyntax`
  (`import type`) + `noUncheckedIndexedAccess` clean; `@setu/core` edge guard
  passes (new modules are Node-free); build keeps fonts + stays jiti-free.

## Definition of done

- `pnpm --filter @setu/core test` (parseContentPath + listContentEntries units),
  `pnpm --filter @setu/git-memory test` + `@setu/git-local test` (list contract),
  `pnpm --filter @setu/admin test` green; typecheck + edge guard clean; build OK.
- `pnpm dev`: publish a post, close its draft (or start from a seeded Git entry) →
  it **still appears** in the content list with a Staged/Live pill; open it → edits
  fork a draft; **Deploy** snapshots it and it goes Live.
- Built test-first via the subagent-driven flow; content safety upheld (listing and
  forking are read-only over Git; no commit path changes).

## Note on scope

Single, well-bounded increment: one new port method (+ both adapters + contract),
one pure parse fn, one pure derivation module, and two app call-sites rewired
(`ContentList`, `deploy()`). Decomposed into tight TDD tasks in the plan.
```
