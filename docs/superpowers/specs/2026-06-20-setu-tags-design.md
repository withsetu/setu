# Tags — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Tagging for posts: chips + prefix-autocomplete in the editor, with suggestions sourced scale-safely from the content index. Built to the finished-feature bar — no MVP stubs.

## Problem & intent

Posts need tags. Unlike categories (hierarchical, bounded, curated — see `setu-categories-taxonomy`), tags are **flat and unbounded** (hundreds–thousands). The defining constraint: the autocomplete must **never load all tags at once** — it sources suggestions from a queryable index, prefix-matched as the user types. This is the L2 index projection that tags were sequenced behind.

A post carries multiple tags (chips). Tags are **free-form**: type anything and it becomes a tag; autocomplete merely helps reuse existing ones.

## Decisions (locked in brainstorm)

- **Identity & case:** tags are **case-insensitive, normalized to lowercase** in the backend. "React" and "react" are the same tag. Display capitalization is the theme's job (CSS), not stored. So a tag is just a normalized lowercase string — no display-name storage, no slug-vs-name split.
- **Normalization:** `normalizeTag(raw)` → lowercase, trim, drop punctuation, spaces/underscores→hyphen, collapse repeats, strip leading/trailing hyphens; returns `''` for empty/symbol-only input. (It is `slugify` without the `'category'` fallback; small intentional duplication to keep tags decoupled from taxonomy.) The UI rejects `''`, so no junk tag is ever created.
- **Free-create + prefix autocomplete:** typing filters existing tags (prefix match from the index); Enter or clicking a suggestion adds a chip; non-matching input + Enter free-creates the tag.
- **Suggestion source:** the content index merges drafts + committed entries, so suggestions include tags from unpublished drafts (a tag you just used is immediately reusable).
- **Normalize-on-add:** the chip stores and displays the normalized form.
- **Lifecycle:** applying a tag to a post is **draft metadata** (`metadata.tags`), committed to frontmatter on publish — same as category assignment. (There is no immediate-commit step for tags; a tag "exists" because an entry uses it.)

## Non-goals (deferred, each its own slice)

- **Filter the listing by tag** — needs a `runQuery` tag filter + listing UI.
- **Tag archive pages** on the rendered site.
- **Tag management** (rename / delete / merge) — no management screen in this slice.
- **Tag-count display.**
- **Category counts / category listing-filter** — same projection mechanism, but a separate slice (do not fold in).

## Architecture

Approach A (chosen): **extend the existing content index** with tags, rather than a separate tag index or on-demand scanning. Tags ride the one projection pipeline (`listContentEntries` → `projectRow` → `IndexPort`) that already rebuilds on save/publish. The `IndexPort` seam means edge can later implement `distinctTags` as SQL `DISTINCT` while the browser uses an idb scan — without touching the UI.

### 1. Core — normalization

New `packages/core/src/tags/normalize.ts`:
- `normalizeTag(raw: string): string` — the transform above; `''` for empty/symbol-only.
- `normalizeTags(raw: string[]): string[]` — map `normalizeTag`, drop `''`, dedupe preserving first-seen order.

Exported from the core barrel.

### 2. Core — index projection

- `ContentRow` (`content-index/list-entries.ts`) gains `tags: string[]`. A `tagsOf(draft, committedStr)` helper (mirroring the existing `titleOf`) reads `metadata.tags` from the draft (else `tags` from parsed committed frontmatter), passing the raw array through `normalizeTags`. Non-array / absent → `[]`.
- `EntryIndexRow` (`index-port/types.ts`) gains `tags: string[]`. `projectRow` copies `row.tags`; `rowToContentRow` copies it back.
- `INDEX_VERSION` bumps (row shape changed) so `ensureBuilt` rebuilds the persisted idb index on next load, repopulating tags. No manual migration needed.
- `runQuery` is **untouched** — tag *filtering* is deferred.

### 3. Core — IndexPort + IndexService

- `IndexPort` gains `distinctTags(prefix: string, limit: number): Promise<string[]>` — distinct tags across all rows whose value starts with the (normalized) prefix, sorted ascending, capped at `limit`. An empty prefix returns the first `limit` tags alphabetically.
- `IndexService` gains `distinctTags(prefix, limit)` delegating to `index.distinctTags`.

### 4. DB adapters

- **db-memory** (`createMemoryIndexPort`): iterate rows, collect a `Set` of tags, filter by `startsWith(normalizedPrefix)`, sort, slice to `limit`.
- **db-idb** (`createIdbIndexPort`): `db.getAll('entries')`, then the same in-JS reduction (consistent with how `query` already loads all rows and delegates to `runQuery`). The DB schema/version is unchanged (tags live inside each row value; no new object store).
- Both behaviors are added to the shared `runIndexPortContract` (`packages/db-testing`) so memory + idb stay in lockstep.

### 5. Admin — TagField in MetaPanel

New `apps/admin/src/editor/TagField.tsx`: `TagField({ selected, onChange, editable }: { selected: string[]; onChange: (next: string[]) => void; editable: boolean })`.
- Renders `selected` as **chips**, each with an × button that removes it (calls `onChange` with the tag filtered out).
- A text input below the chips. On input change (debounced ~150ms), calls `useIndex().distinctTags(value, LIMIT)` and shows matching suggestions as a dropdown, **excluding already-selected tags**.
- Adding a tag (Enter, or click a suggestion): `normalizeTag(value)`; if non-empty and not already in `selected`, `onChange([...selected, tag])`; clear the input + suggestions.
- Empty/symbol-only input contributes no chip.

`MetaPanel.tsx` adds a **Tags** section (below the Categories section) rendering:
```tsx
<TagField
  selected={Array.isArray(metadata['tags']) ? (metadata['tags'] as string[]) : []}
  onChange={(next) => onChange({ ...metadata, tags: next })}
  editable={editable}
/>
```
`TagField` consumes `useIndex()` (the editor is already mounted under `IndexProvider`).

## Data flow

- **Add tag:** type → debounced `distinctTags(prefix)` → dropdown → Enter/click → `normalizeTag` → `onChange(metadata.tags)` → saved with the draft → committed to frontmatter `tags: [...]` on publish.
- **Suggestions:** index rows (drafts + committed, merged) → `distinctTags(prefix, limit)` → sorted, deduped, capped, minus already-selected.
- **Reindex:** on save/publish/deploy the existing `reindexEntry`/`rebuild` paths now also project `tags`, so newly-used tags become suggestable.

## Error handling / edges

- Empty/symbol-only input → `normalizeTag` returns `''` → no chip.
- Duplicate tag → not added twice (dedupe in `TagField` and in `normalizeTags`).
- Suggestions exclude already-selected tags.
- Absent/non-array `metadata.tags` → `[]` (guarded in MetaPanel).
- Index not yet built → `distinctTags` returns `[]` gracefully (`ensureBuilt` runs on mount).
- `INDEX_VERSION` bump rebuilds a stale idb index that lacks `tags`.

## Testing

- **Core normalize:** `normalizeTag` (case, punctuation, spaces, empty→`''`); `normalizeTags` (drop empties, dedupe, order).
- **Core projection:** `tagsOf` reads draft `metadata.tags` and committed frontmatter `tags`, normalizes + dedupes, tolerates absent/non-array; `projectRow`/`rowToContentRow` round-trip `tags`.
- **Core service:** `distinctTags` delegates to the port.
- **Adapters (contract):** `distinctTags` prefix-filters, sorts, dedupes across rows, respects `limit`, handles empty prefix — for memory + idb via `runIndexPortContract`.
- **Admin TagField:** add via Enter (normalized), add via suggestion click, remove chip, no duplicate, no empty chip, suggestions exclude selected. **MetaPanel:** Tags section reads/writes `metadata.tags` safely.

## Sequencing (where the rest lives)

1. **This slice:** tags end-to-end (normalize + index projection + `distinctTags` + chips UI).
2. **Next, enabled by this projection:** filter-listing-by-tag (`runQuery` tag filter + UI); category counts + category listing-filter (extend the same projection).
3. **Later:** tag archive pages (site render); tag management (rename/delete/merge — rename/delete touch every referencing post, so they need the multi-file `GitPort` commit also required by category delete and bulk-ops).
