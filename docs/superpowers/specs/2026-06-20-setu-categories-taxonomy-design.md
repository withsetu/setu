# Categories & Taxonomy — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** A complete categories experience for the admin editor: create categories inline while writing, nest them, select them on a post, and re-organize (re-parent / rename label) from a management screen. Built to the finished-feature bar — no MVP stubs.

## Problem & intent

Posts need categories. The defining requirement (from the user): **editors create categories inline while writing a post — pre-definition is NOT required.** WordPress-style. Typing a new category in the post sidebar creates it and applies it in one move. A management screen exists for later housekeeping, but it is never a prerequisite for using categories.

Categories are **hierarchical** (a category can have a parent) and a post can carry **multiple** categories (checkbox multi-select).

This is the first slice of "individual field editing" (L1), built to the quality bar in `setu-quality-bar` — complete for its scope, designed Git-native rather than bolted on.

## Non-goals (explicitly deferred, each to its own complete slice)

- **Tags.** Different data shape (flat, unbounded — hundreds/thousands), different UI (chips + autocomplete), different scaling story. A `tags.yaml` registry does not scale; tag autocomplete must be **index-backed** (distinct-tags projection over the content index — SQL `DISTINCT`/prefix-search on edge, idb index in browser) so the editor never loads all tags at once. Tags are therefore sequenced **with the L2 index projection**, as their own slice. Not in this spec.
- **Delete a category** and **rename a category's slug.** Both must rewrite every post that references the slug (frontmatter edits across N entry files). `GitPort.commitFile` writes one file per commit, so these need a new **multi-file commit** capability in `GitPort` — which is also the foundation for bulk operations (L3). Own slice, built once, powers both.
- **Per-category entry counts** ("Tutorials (12)"). Needs entry-usage data = the **L2 index projection**. Ships with L2, not faked here.
- **Category archive pages** on the rendered site. Site-render concern, later.
- **Filter the admin listing by category.** Needs L2 (index projects category refs). Later.
- **Bulk apply a category to many posts** (L3).

## Scope boundary (what IS in this slice)

1. Git-native data model (`taxonomy/categories.yaml` + frontmatter `categories: [slug]`).
2. A pure, topology-agnostic `core/taxonomy` module.
3. An admin taxonomy service/provider (read + create + rename-label + reparent, committing to `categories.yaml`).
4. MetaPanel category control: checkbox tree + inline "+ New category" (the hero — the writing flow).
5. Management screen (cheap tier): tree view, re-parent, rename label.

## Architecture

### 1. Data model (Git-native)

**`taxonomy/categories.yaml`** at repo root (sibling to `content/`). A **flat list with parent refs** (not nested YAML — flat diffs are cleaner and re-parenting is a one-line change):

```yaml
- slug: tutorials
  name: Tutorials
  parent: null
- slug: react
  name: React
  parent: tutorials
```

- `slug` — stable identifier; what posts reference. Unique.
- `name` — human display label; freely renamable without touching posts.
- `parent` — slug of the parent category, or `null` for a root. Single parent (a tree, not a DAG).

Posts reference categories **by slug** in frontmatter:

```yaml
categories: [react, tutorials]
```

Referencing by slug (not name) is precisely what lets a label be renamed without rewriting any post.

The file is **auto-maintained** by inline creation — it is a *record of categories that exist*, never a setup form the user fills out first. It may not exist until the first category is created (treat absent file as empty list).

### 2. Core module — `packages/core/src/taxonomy/`

Pure functions, no I/O, fully unit-testable. Topology-agnostic (same code in browser/server/edge).

Types:

```ts
type Category = { slug: string; name: string; parent: string | null }
type CategoryNode = Category & { children: CategoryNode[]; depth: number }
```

Functions:
- `parseCategories(yaml: string): Category[]` — tolerant of absent/empty file (→ `[]`).
- `serializeCategories(cats: Category[]): string` — deterministic output (stable key order, stable sort) so diffs are minimal.
- `buildTree(cats: Category[]): CategoryNode[]` — assembles the hierarchy; surfaces orphans (parent missing) and cycles defensively rather than infinite-looping.
- `slugify(name: string): string` — produce a slug from a display name.
- Pure mutation ops returning a **new** list, each validating invariants (unique slug, parent exists, no cycle):
  - `addCategory(cats, { name, parent }): { cats, slug }` — slugified, uniqueness-resolved.
  - `renameLabel(cats, slug, name): cats` — changes `name` only.
  - `reparent(cats, slug, parent): cats` — changes `parent`; rejects if it would create a cycle.

Validation errors are typed/returned, not thrown-as-strings, so the UI can show them.

### 3. Admin taxonomy service / provider

A provider (modeled on `IndexProvider`) so the MetaPanel and the management screen share one in-memory source of truth and stay consistent.

- **Load:** read `taxonomy/categories.yaml` via `GitPort.readFile` (absent → empty), parse, hold in context. Track `headSha` for freshness.
- **Mutations:** `create({ name, parent })`, `renameLabel(slug, name)`, `reparent(slug, parent)` — apply the pure op → `serializeCategories` → `GitPort.commitFile('taxonomy/categories.yaml', …)` → update in-memory state. Returns the new list (and, for create, the new slug).

**Two deliberate lifecycle splits:**

- **Creating / editing a category commits to `categories.yaml` immediately.** It is shared infrastructure, not part of any one post's draft. (Decision: taxonomy commits immediately, not staged with drafts.)
- **Tagging *this post* with a category is draft metadata** — the post's `categories` array lives in the draft, saved with the draft, and committed with the post on its normal draft → publish lifecycle.

So: creating a category is instant + shared; applying it to a post follows the post's publish flow.

**Concurrency assumption:** single-writer for `categories.yaml` (same assumption as content-index Slice 1). Concurrent category edits from two tabs could lost-update. Acceptable now; revisited when edge/multi-writer mode lands.

### 4. MetaPanel category control (the writing flow — the hero)

Extends `apps/admin/src/editor/MetaPanel.tsx` (today it edits Status + read-only Slug/Locale).

- **Checkbox tree** — categories rendered as an indented hierarchy from `buildTree`. Toggling a checkbox adds/removes that slug in the draft's `categories` array (draft metadata; persisted with the draft).
- **Inline "+ New category"** — a name field + optional parent selector (choose an existing category as parent, or none). Submitting calls `taxonomyService.create({ name, parent })`; the new category is created in `categories.yaml` and appears in the tree **already checked** on this post. No leaving the editor, no pre-setup.

Empty state (no categories yet) still shows the inline create affordance front-and-center.

### 5. Management screen (cheap tier only)

New admin route `/categories`.

- **Tree view** of all categories (indented hierarchy).
- **Re-parent** — move a category under a different parent (or to root). Single-file edit to `categories.yaml`.
- **Rename label** — edit the display `name`. Single-file edit; touches no posts.

**Honesty note:** per-category entry **counts are NOT shown here** — they require entry-usage data (the L2 index projection) and will ship with L2. We do not fake them.

**Delete** and **slug-rename** are absent from this screen by design (the deferred file-touching tier).

## Data flow

- **Create (inline):** editor types name (+ optional parent) → `core.addCategory` (pure, validated) → service serializes + `commitFile` → provider state updates → checkbox tree re-renders with the new category checked → slug added to the draft's `categories`.
- **Select:** toggle checkbox → draft `categories` array updated → saved with the draft → committed with the post on publish.
- **Re-parent / rename-label (management):** UI action → `core.reparent` / `core.renameLabel` (pure, validated) → service serializes + `commitFile` → provider state updates → both MetaPanel and management screen reflect it.

## Error handling

- Absent/empty `categories.yaml` → empty list, no error (first-run normal).
- Duplicate slug on create → slugify resolves uniqueness (e.g. suffix) rather than erroring; user sees the resolved category.
- Re-parent that would create a cycle → rejected by the pure op; UI shows a validation message, no commit.
- Orphaned `parent` ref (parent removed out-of-band) → `buildTree` surfaces the node at root rather than dropping or looping.
- `commitFile` failure → surfaced to the UI; in-memory state not advanced past the failed write.
- A post referencing a slug not in `categories.yaml` → tolerated (renders the raw slug); not an error.

## Testing

- **Core (`core/taxonomy`)** — pure unit tests: parse/serialize round-trip (incl. empty/absent), `buildTree` (nesting, orphans, cycles), `slugify` + uniqueness, each mutation op incl. invariant rejections (cycle on reparent, parent-exists).
- **Admin taxonomy service** — against a memory/testing `GitPort`: load (absent → empty), create commits expected YAML, rename/reparent commit expected YAML, in-memory state matches committed state.
- **MetaPanel** — checkbox toggles update draft `categories`; inline create adds + checks a category; nested rendering; empty state shows create affordance.
- **Management screen** — tree render, re-parent, rename-label flows.

## Sequencing (where the rest lives)

1. **This slice:** categories — create-inline, nest, select, re-parent, rename-label. Complete for its scope.
2. **Next (own seam):** delete + slug-rename → build multi-file commit in `GitPort` (also the bulk-ops L3 foundation).
3. **Tags:** own slice, sequenced with the L2 distinct-tags index projection (scale-safe autocomplete).
4. **Later (L2/L3/site):** counts, category archive pages, filter-listing-by-category, bulk apply.
