# Bulk Operations — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Select multiple entries on the Posts/Pages listing and apply a bulk action — add/remove a category, add/remove a tag, or delete — each committed as ONE atomic Git commit. Slice 2 of the bulk-ops arc; builds on `commitFiles`.

## Problem & intent

The original ask that started this arc: bulk actions (assign tags/categories, bulk delete) because doing them one entry at a time is tedious. Individual category/tag editing now exists; `commitFiles` (atomic multi-file commit) now exists. This slice delivers the user-facing bulk operations on top of both.

## Decisions (locked in brainstorm)

- **Immediate commit:** a bulk action applies to each selected entry's current content and commits all of them in **one `commitFiles`** — live instantly (not staged). This is the expected bulk-ops behavior and what `commitFiles` was built for.
- **Heads-up count:** before a metadata action, surface how many selected entries have unpublished draft changes (committing them also publishes those edits) — informational, not blocking.
- **Action set (v1):** Add category, Remove category, Add tag, Remove tag, Delete.
- **Selection is current-page-scoped** (ephemeral React state) with a "select all on this page" header checkbox. No select-all-across-pages/all-matching in v1.
- **Delete confirms** (it removes committed content); metadata actions don't.

## Non-goals (deferred)

- Bulk publish / unpublish (status changes); bulk change-author (no users system).
- Select-all-matching-the-filter across pages; undo; progress bar for very large batches.

## Architecture

### 1. Core — `bulkService` (`packages/core/src/bulk/`)

A topology-agnostic service (like publish-service), `createBulkService({ data, git, read, author })`:

```ts
interface BulkResult {
  committedSha: string | null   // the one commit's sha, or null if nothing changed
  applied: EntryRef[]           // entries included in the commit
  skipped: { ref: EntryRef; reason: 'absent' }[]  // couldn't load (vanished)
}

interface BulkService {
  applyMetadata(refs: EntryRef[], mutate: (meta: Record<string, unknown>) => Record<string, unknown>, message?: string): Promise<BulkResult>
  deleteEntries(refs: EntryRef[], message?: string): Promise<BulkResult>
}
```

- **`applyMetadata`** — for each ref: `read.loadForEdit(ref)` → editable `{content, metadata}` (forking a live entry into a draft if needed); `source === 'absent'` → record `skipped`. Else compute `next = mutate(metadata)`, serialize `serializeMdoc({ frontmatter: next, body: tiptapToMarkdoc(content) })`, push `{ path: contentPath(ref), content }` to the batch (remember per-ref `next`+content). Then **one `commitFiles({ changes, message, author })`**. `commitFiles` already skips per-path no-ops, so entries the mutation didn't actually change cause no churn. After commit, advance each applied entry's draft base: `data.saveDraft({ ...ref, content, metadata: next, baseSha: sha, baseContent: content })` (mirrors publish-service).
- **`deleteEntries`** — for each ref: read `git.readFile(contentPath(ref))`; if non-null, push `{ path, delete: true }` to the batch; always `data.deleteDraft(ref)` (no-op if none). **One `commitFiles`** for the file removals (skipped if the batch is empty — e.g. all draft-only entries). Returns the affected refs.

### 2. Core — pure metadata mutations (`packages/core/src/bulk/mutations.ts`)

Small pure helpers the UI passes into `applyMetadata`:
- `addCategory(meta, slug)` / `removeCategory(meta, slug)` — operate on `meta.categories` (slugs, deduped; absent/non-array → `[]`).
- `addTag(meta, tag)` / `removeTag(meta, tag)` — `tag` normalized via `normalizeTag`; operate on `meta.tags`.
Each returns a new metadata object; an add that's already present returns metadata unchanged (→ `commitFiles` no-op for that entry).

### 3. Admin — services wiring

Add `bulk: BulkService` to the `Services` bundle (`servicesFor` builds it via `createBulkService({ data, git, read, author: OWNER_AUTHOR })`). After any bulk action the admin best-effort `index.reindexEntry(ref)` for each affected/deleted ref (mirroring the editor's post-publish reindex), then re-queries the listing.

### 4. Admin — selection + bulk action bar (`ContentList`)

- **Selection state:** a `Set<string>` of row keys (`collection\0locale\0slug`) in component state (ephemeral; cleared on filter/page/collection change and after an action). A checkbox column; a header checkbox selects/deselects all rows on the current page.
- **Bulk action bar** (sticky, shown when ≥1 selected) — a new `apps/admin/src/screens/BulkBar.tsx`: "N selected" + controls:
  - **Category:** a category `<select>` (from `useTaxonomy`) + **Add** / **Remove** buttons.
  - **Tag:** the `TagFilter`-style typeahead (or a small input) + **Add** / **Remove**.
  - **Delete** button.
  - **Clear** selection.
- Metadata actions show the **heads-up count** inline ("N of M have unpublished changes that will also go live") before/while applying. **Delete** opens a confirm ("Delete N entries? This commits their removal.").
- On action: call `services.bulk.*`, reindex affected refs, re-query, clear selection, show a brief result ("Updated N", "Deleted N", or "N skipped").

### 5. Heads-up count (derivation)

From the already-loaded index rows: an entry has "unpublished changes" when `row.hasDraft && row.lifecycle.state !== 'live'` (a draft ahead of / without a committed version). The bar counts selected rows meeting this and shows the note for metadata actions.

## Data flow

Select rows → bulk bar → choose action → (delete: confirm) → `services.bulk.applyMetadata|deleteEntries(selectedRefs, …)` → one `commitFiles` → per-ref `reindexEntry` → re-query listing → clear selection → result toast.

## Error handling / edges

- **Absent entry** (vanished between list and action) → skipped, reported in the result; the rest commit.
- **Atomic:** `commitFiles` is one commit — no partial state. If the commit throws, surface an error; selection retained.
- **No-op metadata** (add a category an entry already has) → `commitFiles` per-path no-op; entry effectively unchanged.
- **Single-writer assumption:** no per-entry external-conflict detection in v1 (consistent with the rest of the admin).
- Empty selection → the bar isn't shown; actions are unreachable.

## Testing

- **Core `bulkService`:** `applyMetadata` commits one batch + advances each applied entry's base; forks a live entry then applies; an absent ref is skipped + reported; a no-op mutation produces no churn (commit sha unchanged when nothing changes). `deleteEntries` removes committed files + drafts in one commit; draft-only entry → deleteDraft, no commit.
- **Core mutations:** add/remove category & tag (dedupe, normalize, absent→[], already-present no-op).
- **Admin:** row checkboxes + select-all-page + clear; bulk bar appears with count; an action calls the service with the selected refs, reindexes, re-queries, clears; delete confirm; heads-up count renders.

## Sequencing

1. **This slice:** select (current page) + add/remove category & tag + delete, immediate one-commit, heads-up, delete confirm.
2. **Deferred:** bulk publish/unpublish (status), change-author, select-all-matching, undo. **Category delete & slug-rename** (separate feature) also now buildable on `commitFiles`.
