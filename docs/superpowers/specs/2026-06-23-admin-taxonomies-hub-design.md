# Admin Taxonomies hub — Categories tab (PR 1)

Status: approved design, ready for plan
Date: 2026-06-23
Surface PR in the `@setu/admin` shadcn migration (supersedes the standalone `/categories` screen).

## Goal

Replace the standalone Categories screen with a **Taxonomies hub** — one screen, tabbed
**Categories | Tags** — that becomes the single place to manage content taxonomies. This PR
delivers the **Categories tab** in full and a polished "coming soon" **Tags tab** placeholder.
Tags management (counts, rename, merge, delete) is a follow-up PR (PR 2) and is **out of scope**
here.

This is both a shadcn/aesthetic migration of the existing screen **and** net-new capability:
category **delete** (which does not exist anywhere today) and per-category **usage counts**.

## Why a hub (scope rationale)

Categories and tags are sibling editorial taxonomies (both are arrays of canonical strings on
content, both filter content, both want counts + rename + delete). A tabbed hub gives users one
place and pays down two deferred debts (category delete, category counts). We deliberately do
**not** build a generic taxonomy engine — locales/collections are hard-coded structural paths,
authors aren't in the model, block-categories are a code enum; none are editable registries.
The hub is architected so a third tab is cheap later, but no generic registration system is built.

## Current state (what exists)

- Registry: `taxonomy/categories.yaml` — array of `{ slug, name, parent: string|null }`.
- Core (`packages/core/src/taxonomy/`): pure ops `addCategory`, `renameLabel`, `reparent`
  (cycle-guarded), `slugify`, `buildTree` (recursive, yields `depth`); `TaxonomyService`
  reads the file, applies a pure op, commits the **whole file** via `git.commitFile` (single file).
  There is **no remove/delete op or method**.
- Admin screen `apps/admin/src/screens/Categories.tsx` — bespoke HTML (`category-new`,
  `category-manage-list`, raw `<input>`/`<select>`), flat list with depth indentation, inline
  rename on blur, parent `<select>`. Route `/categories`; sidebar "Categories" (Folder icon).
- Content attaches categories as **slugs** in frontmatter `categories: [...]`. The content index
  (`EntryIndexRow.categories: string[]`) tracks them and supports a `category?` query filter, but
  exposes **no** `distinctCategories` and **no** usage counts.
- `GitPort.commitFiles` exists (atomic multi-file writes+deletes) — used by bulk ops already.

## Architecture

### Core / data changes (`@setu/core`)

1. **`removeCategory(cats, slug)`** — new pure op in `taxonomy/ops.ts`.
   - Removes the node with `slug`.
   - **Promotes its children**: any category whose `parent === slug` is reparented to the removed
     node's own parent (one level up; `null` if the removed node was top-level). Grandchildren are
     untouched (they still point at their own parent, which still exists).
   - Throws `TaxonomyError('not-found')` if the slug is absent.
   - Returns the new `Category[]`. Pure — no IO. Fully unit-tested.

2. **Category usage counts** — a way to count how many content entries reference each category
   slug, sourced from the content index (so it reflects the draft overlay, across all collections
   and locales). Surface as a small core/query helper (e.g. counts keyed by slug). Used for the
   `Used by N` column and the delete confirm. (This is the missing `distinctCategories`-with-counts
   capability, scoped to counts we actually need.)

3. **`TaxonomyService.remove(slug)`** — new method. Unlike rename/reparent it **cannot** use the
   single-file `commitFile`, because deleting a used category must also strip the slug from content.
   Steps, committed **atomically** via `GitPort.commitFiles`:
   1. Query the content index for entries whose `categories` include `slug`.
   2. For each such entry, rewrite its frontmatter to drop `slug` from the `categories` array
      (preserve order of the rest; leave the field as an empty array or omit per existing
      serialization convention — match how `categories: []` is currently written/read).
   3. Apply `removeCategory` to `categories.yaml` (drops the definition + promotes children).
   4. Commit all file writes (the yaml + every rewritten entry) in one `commitFiles` call with a
      message like `taxonomy: delete category <slug> (strip from N entries)`.
   - Promoting children needs **no** content rewrite — children keep their own slugs; only the
     deleted slug is stripped from content.
   - The existing `create/renameLabel/reparent` methods are unchanged (still single-file commits).

> Open implementation detail for the plan: deciding the exact seam for "find entries by category +
> rewrite frontmatter" — reuse the index query + existing frontmatter read/write helpers used by
> bulk ops (the bulk add/remove-category feature already rewrites `categories` frontmatter across
> many files via `commitFiles`; reuse that path rather than inventing a new one).

### Admin UI changes (`@setu/admin`)

1. **New `screens/taxonomies/` directory**, decomposed:
   - `Taxonomies.tsx` — the hub: `PageHeader` ("Taxonomies", subtitle) + shadcn **Tabs**
     (`Categories` | `Tags`), wrapped in `PageBody`.
   - `CategoriesTab.tsx` — the full Categories management UI.
   - `CategoryTree.tsx` (+ row component) — renders `buildTree` output at **arbitrary depth**:
     indentation scales per `depth`, a faint vertical guide line per ancestor level. Each row:
     inline-rename name (click-to-edit, commit on blur/Enter), muted `/slug`, `Used by N`
     (or "unused"), a **"Move to…"** parent `Select`, and a delete (trash) action.
   - `NewCategoryForm.tsx` — name `Input` + optional parent `Select` + "Add category" button;
     Enter submits (matches the editor/list interaction polish).
   - `DeleteCategoryDialog.tsx` — shadcn `AlertDialog`: shows the usage count and the promote-
     children note, e.g. *"Used by 12 entries — deleting removes it from them. Child categories
     move up one level."* Confirm calls `TaxonomyService.remove`.
   - `TagsTab.tsx` — polished empty/"coming soon" state (icon + one-line copy). No logic.

2. **"Move to…" picker** lists all categories **except the node itself and its descendants**
   (prevents offering a cycle-creating target). The `reparent` cycle guard remains the backstop;
   on a rejected move show `notify.error` with the message (current behavior).

3. **Aesthetic** — loose/modern per `[[setu-admin-visual-aesthetic]]` and the approved mockup:
   generous row height, 15px medium titles + muted `/slug`, sentence-case muted column header,
   faint dividers, `--primary` (indigo) for the active tab indicator and the primary "Add" button.
   Reuse the shared shadcn primitives (`Tabs`, `Input`, `Select`, `Button`, `AlertDialog`,
   `Table` or a div-grid as the tree dictates). Restrained motion only (no drag-drop reparent).

4. **Routing / nav**:
   - New route `/taxonomies` → `Taxonomies`.
   - `/categories` **redirects** to `/taxonomies` (keep old bookmarks/links alive).
   - Sidebar "Categories" item → **"Taxonomies"** (keep the Folder icon, or a more apt icon).
   - Editor's inline `CategoryField` is unchanged (it selects existing categories; not part of
     this screen).

## Data flow

- Read: `TaxonomyService.read()` → `buildTree` → tree rows (with `depth`). Counts come from the
  index helper keyed by slug, merged into rows for display.
- Mutate: create/rename/reparent → existing single-file commit methods (unchanged). Delete →
  new `remove` method (atomic multi-file commit). After any mutation the taxonomy store updates
  `categories` and the screen re-renders; counts refetch as needed.
- The hub keeps the existing `useTaxonomy` store (`data/taxonomy-store.tsx`) as the source for
  category state; extend it with `remove` and a counts source.

## Error handling

- `removeCategory` / `reparent` / `renameLabel` throw typed `TaxonomyError`; the UI surfaces the
  message via `notify.error` (existing pattern).
- Delete is guarded behind the `AlertDialog` confirm; the dialog states the side effects (strip +
  promote) before the user commits.
- Empty/whitespace names rejected (`empty-name`) — existing behavior preserved.

## Testing

- **Core (TDD, unit):** `removeCategory` — removes node; promotes direct children to the removed
  node's parent (incl. top-level → `null`); leaves grandchildren intact; throws on missing slug.
  Usage-count helper — counts across collections/locales, reflects draft overlay, zero → "unused".
  `TaxonomyService.remove` — strips the slug from exactly the referencing entries, removes the
  definition, promotes children, and commits **once** via `commitFiles` (assert the atomic call
  shape with a fake GitPort); no-op-safe when the category is unused (yaml-only change).
- **Admin (component):** tree renders arbitrary depth with correct indentation; "Move to…"
  excludes self + descendants; delete dialog shows the right count + copy and calls `remove`;
  `/categories` redirects to `/taxonomies`; tab switch renders Categories vs Tags-placeholder.
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green; no regression in existing
  taxonomy/editor tests.

## Out of scope (PR 2 and beyond)

- Tags management (counts, rename, **merge**, delete) — the Tags tab is a placeholder here.
- Category **merge** (fold one category's content into another) — not requested; revisit if needed.
- Drag-and-drop reparenting — picker only.
- Generic / custom taxonomies, locales, collections, authors as managed taxonomies.

## Decomposition (for the plan)

1. Core: `removeCategory` op (TDD) + usage-count helper (TDD).
2. Core: `TaxonomyService.remove` via `commitFiles`, reusing the bulk-ops frontmatter-rewrite path
   (TDD with a fake GitPort).
3. Admin store: extend `useTaxonomy` with `remove` + counts.
4. Admin: hub shell (`Taxonomies` + Tabs) + routing/redirect + sidebar rename + Tags placeholder.
5. Admin: `NewCategoryForm` + `CategoryTree`/row (arbitrary depth, inline rename, move picker,
   counts).
6. Admin: `DeleteCategoryDialog` wired to `remove`.
7. Cleanup: delete old `screens/Categories.tsx` + its dead bespoke CSS.

Built subagent-driven per `[[setu-execution-default]]`.
