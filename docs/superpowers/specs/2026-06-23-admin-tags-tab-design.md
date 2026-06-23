# Taxonomies hub — Tags tab (PR 2)

Status: approved design, ready for plan
Date: 2026-06-23
Second PR of the Taxonomies hub (PR 1 shipped the hub shell + Categories tab — [PR #33](https://github.com/saytudev/setu/pull/33)).

## Goal

Replace the Tags tab's "coming soon" placeholder with a real management surface: a searchable,
sortable list of every tag with its usage count, supporting **rename**, **merge**, and **delete** —
all as atomic content rewrites. No new registry; tags stay emergent and normalized.

## Why this is simpler than Categories

Tags have **no registry file** (unlike `taxonomy/categories.yaml`) and **no hierarchy**. They exist
only as normalized strings inside each entry's `metadata.tags`. So every management action is a
*pure content rewrite* — there is no second file to keep in sync, which means we can lean directly
on the existing `BulkService.applyMetadata(refs, mutate)` (one atomic commit) rather than building a
bespoke orchestrator like `createCategoryDeleter`. Consequently there is **no "unused" tag** — every
tag in the list has count ≥ 1 by definition.

## Current state (what exists)

- Tags are normalized via `normalizeTag` (`packages/core/src/tags/normalize.ts`): lowercase, trim,
  strip punctuation, spaces/underscores → hyphens, collapse repeats. Stored as `metadata.tags: string[]`.
- `IndexPort.distinctTags(prefix, limit)` — prefix autocomplete only (no full list, no counts).
- Bulk metadata mutations (`packages/core/src/bulk/mutations.ts`, exported aliased):
  - `addTag(meta, rawTag)` — normalizes `rawTag`, adds to `meta.tags` deduped; no-op if empty-after-normalize or already present.
  - `removeTag(meta, rawTag)` — normalizes, removes; no-op if absent.
  - (Barrel aliases: `bulkAddTag`, `bulkRemoveTag`.)
- `BulkService.applyMetadata(refs, mutate, message)` — applies `mutate` to each entry's metadata,
  commits all in ONE commit, saves drafts. Does NOT reindex (the caller does — see `BulkBar`).
- `BulkBar` precedent (`apps/admin/src/screens/BulkBar.tsx`): after `applyMetadata`, it reindexes
  each applied ref: `for (const ref of r.applied) await index.reindexEntry(ref)`. We mirror this.
- IndexPort now has `categoryCounts()` + `entriesByCategory()` (PR 1) — we add the tag equivalents
  the same way.
- The Tags tab is currently `TagsTab.tsx`, a static "coming soon" placeholder.

## Architecture

### Core / data changes (`@setu/core`)

Two new IndexPort methods, wired identically to PR 1's category methods (shared pure helper → port
interface → IndexService passthrough → barrel → both adapters delegating to the helper → contract):

1. **`selectTagCounts(rows): Record<string, number>`** + **`IndexPort.tagCounts(): Promise<Record<string, number>>`**
   — usage count per tag across all rows. Its keys ARE the tag list (drives both the list and the counts).
2. **`selectEntriesByTag(rows, tag): EntryRef[]`** + **`IndexPort.entriesByTag(tag): Promise<EntryRef[]>`**
   — refs of every entry whose `tags` include `tag`.

No new service, no new yaml. Rename/delete are composed from existing pieces (see store).

### Admin store (`@setu/admin`) — `useTags`

New hook `apps/admin/src/data/tags-store.tsx` (`TagsProvider`/`useTags`), mounted inside
`IndexProvider` (same as `TaxonomyProvider`). Mirrors the `useTaxonomy` shape:

- State: `counts: Record<string, number>` (refreshed via `index.tagCounts()` on mount + after every op).
- `rename(from: string, to: string): Promise<{ applied: number; merged: boolean }>`:
  1. `target = normalizeTag(to)`; if `target === ''` throw (empty), if `target === from` no-op.
  2. `merged = counts[target] !== undefined`.
  3. `refs = await index.entriesByTag(from)`.
  4. `result = await bulk.applyMetadata(refs, (m) => bulkAddTag(bulkRemoveTag(m, from), target), \`tags: rename ${from} → ${target}\`)`.
     (`bulkRemoveTag` drops `from`; `bulkAddTag` adds the normalized `target`, de-duping — so an entry
     that already had `target` collapses to one occurrence. This yields pure-rename when `target` is
     new and merge-with-dedupe when it exists, from a single closure.)
  5. Reindex each `result.applied` ref (`index.reindexEntry`).
  6. Refresh counts; return `{ applied: result.applied.length, merged }`.
- `remove(tag: string): Promise<{ applied: number }>`:
  1. `refs = await index.entriesByTag(tag)`.
  2. `result = await bulk.applyMetadata(refs, (m) => bulkRemoveTag(m, tag), \`tags: delete ${tag}\`)`.
  3. Reindex applied refs; refresh counts; return `{ applied: result.applied.length }`.
- Deps from `useServices()` (`bulk`) + `useIndex()` (IndexService: `entriesByTag`, `tagCounts`, `reindexEntry`).

> The rewrite + reindex orchestration lives in the hook (not core) because it is pure composition of
> two existing services (`bulk` + `index`) and exactly mirrors the in-admin `BulkBar` precedent. Merge
> correctness (dedupe) is already covered by the bulk-mutation unit tests; the hook is tested as a hook.

### Admin UI (`@setu/admin`) — Tags tab

Replace `TagsTab.tsx` placeholder with the real surface, decomposed:

- `TagsTab.tsx` — owns search + sort state and the `pendingDelete` / `pendingMerge` dialog state;
  derives the displayed rows from `useTags().counts`.
- `TagList.tsx` (+ row) — flat list (tags can be many). Each row: inline-editable name (commit on
  blur/Enter), "Used by N" (`N entries`), a ghost delete (trash) button.
- `TagToolbar.tsx` — a search `Input` (filters the list, case-insensitive substring on the tag) and a
  sort `Select` (**Most used** = count desc, tie-break A–Z [default]; **A–Z**).
- `DeleteTagDialog.tsx` — shadcn `AlertDialog`: *"Delete `react`? Used by 24 entries — this removes
  the tag from them."* Confirm → `remove`.
- `MergeTagDialog.tsx` — shadcn `AlertDialog`, shown when an inline rename's normalized target already
  exists: *"`reactjs` already exists — merge `react` (24 entries) into it? This can't be auto-undone."*
  Confirm → `rename` (proceeds with the merge). Cancel → revert the inline edit.
- A small static hint line under the list explaining that renaming to an existing tag merges (matches
  the approved mockup).

Inline rename flow:
1. User edits the name in place, commits (blur/Enter). Normalize the input.
2. If normalized value is empty or unchanged → revert (no-op).
3. If normalized target already exists in `counts` (and ≠ the row's own tag) → open `MergeTagDialog`.
4. Else → call `rename` directly and toast *"Renamed `react` → `reactjs` across N entries"* (`useNotify`).

Empty state: when `counts` is empty → *"Tags appear here as you add them to content."*

Aesthetic: loose/modern per `setu-admin-visual-aesthetic` and the approved mockup — generous rows,
15px medium tag name, sentence-case muted header, faint dividers, `--primary` indigo, search icon in
the input, restrained. Reuse shared shadcn primitives (`Input`, `Select`, `Button`, `AlertDialog`).

## Data flow

- Read: `index.tagCounts()` → counts map → filtered by search → sorted → rows.
- Mutate: rename/remove → `bulk.applyMetadata` (one commit) → reindex applied refs → `index.tagCounts()`
  refresh → re-render. No stale-index window (reindex precedes the count refresh).

## Error handling

- Empty-after-normalize rename target → rejected (no-op + optional notify).
- `bulk.applyMetadata` / reindex failures surface via `useNotify().error` (existing pattern); reindex
  per-ref failures are caught individually (as `BulkBar` does) so one bad ref doesn't abort the batch.
- Merge and delete are guarded behind `AlertDialog` confirms.

## Testing

- **Core (TDD, unit + contract):** `selectTagCounts` (tally across rows, multi-tag entries, empty);
  `selectEntriesByTag` (refs across collections, none → []); both wired into the `runIndexPortContract`
  suite and verified on both adapters.
- **Admin hook (`tags-store.test.tsx`):** pure rename (target new) rewrites the referencing entries and
  updates counts (old key gone, new key present); **merge** (rename to an existing tag) dedupes — an
  entry that had both ends with one occurrence, and the two counts collapse into one; delete strips the
  tag and drops it from counts; counts refresh after each op. Seeded via the same provider harness as
  `taxonomy-store.test.tsx` (ServicesProvider → DeployProvider → IndexProvider → TagsProvider) with a
  rebuilt index.
- **Admin component (`TagsTab.test.tsx`):** list renders tags with counts, sorted; search filters;
  inline rename to a NEW name calls `rename` (no merge dialog); inline rename to an EXISTING tag opens
  the merge dialog and confirming calls `rename`; delete opens its dialog and confirming calls `remove`;
  empty state when no tags.
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green (the gate must include typecheck —
  vitest alone does not typecheck).

## Out of scope (later)

- Multi-select "merge these N tags into one" (the unified rename already delivers merge; bulk-select is
  a fast-follow if cleanup-heavy use emerges).
- A tags registry / tag descriptions / tag pages on the site.
- Tag-filter on listings already exists (the index `tag` query) — unchanged here.

## Decomposition (for the plan)

1. Core: `tagCounts` (helper + all layers + contract, TDD).
2. Core: `entriesByTag` (helper + all layers + contract, TDD).
3. Admin: `useTags` store (rename/merge + delete + counts + reindex, TDD hook).
4. Admin: Tags tab UI — `TagsTab` + `TagList` + `TagToolbar` + `DeleteTagDialog` + `MergeTagDialog`,
   replacing the placeholder (TDD component).
5. Cleanup + full gate.

Built subagent-driven per `[[setu-execution-default]]`.
