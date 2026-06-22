# Admin Content Lists Redesign — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** `apps/admin` content lists (`screens/ContentList.tsx` = Posts & Pages, + `TagFilter`, `BulkBar`)
**Depends on:** shadcn foundation (#25) + dashboard (#27) + shell (#29), all merged. Branch `admin-content-lists` off `main`.

## 1. Goal

Rebuild the Posts/Pages list on shadcn and add real list capabilities, while preserving every existing behavior (URL-backed filters, sort, server-style pagination, per-page bulk selection). This is a re-skin **plus** new features — not a rewrite of the query layer.

## 2. New capabilities (decided)

- **More columns:** add **Tags** and **Categories** columns (both already in `ContentRow`). **Author is deferred** — there is no author field in the content model / index / actor identity yet; it becomes its own feature later.
- **Locale column:** shown by default **only when the site has >1 language** (auto), and toggleable in the column picker.
- **Column picker:** a "Columns" `DropdownMenu` of checkboxes to show/hide **Status · Tags · Categories · Locale · Updated**. **Title is always shown.** Choices are **remembered per browser** (`localStorage`, key `setu-list-columns`).
- **Layout/padding:** the whole list sits inside the `PageBody` gutter (already), AND the table has **comfortable internal horizontal padding** so the first (checkbox/Title) and last columns don't hug the card border.

## 3. Columns

Order: `[select] · Title · Status · Tags · Categories · Locale · Updated`, with the existing "view on site" link on the Title cell for staged/live rows.

- **Title** — always visible; links to `/edit/{collection}/{locale}/{slug}` (the row is **not** whole-clickable — title is the target). Truncates with ellipsis.
- **Status** — `Badge` via the shared `statusBadge(lifecycle)` (draft→warning, staged→info, live→success, unpublished→secondary); keeps the existing `· pending` suffix when present.
- **Tags** — `ContentRow.tags[]` rendered as up to **2 chips + "+N"**; "`—`" when empty.
- **Categories** — `ContentRow.categories[]` (slugs) resolved to display names via the taxonomy (`useTaxonomy` + `buildTree`); up to **2 + "+N"**; "`—`" when empty.
- **Locale** — `ref.locale`; auto-visible only when `distinctLocales().length > 1`.
- **Updated** — relative time (reuse the dashboard's `relativeTime`); "`—`" when null.

Sortable headers (lucide arrow indicator): **Title · Status · Updated** (the sort keys the `index.query` seam supports today). Tags/Categories/Locale are not sortable (the index doesn't sort on them).

## 4. Toolbar (shadcn)

- **Search** — `Input` with a leading search icon; the existing 200ms debounce → URL `q`.
- **Status** — `Select` (All status + the four lifecycle states).
- **Category** — `Combobox` (hierarchical, indented names from the taxonomy).
- **Tag** — migrate `TagFilter` to a `Combobox` backed by the index's tag suggestions.
- **Clear filters** — `Button` (shown when filters are active), as today.
- **Columns** — the `DropdownMenu` picker (§2).

## 5. Table, bulk, pager (shadcn)

- **Table** — shadcn `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableBody`/`TableCell`, inside a bordered card with internal horizontal padding; row hover via tokens.
- **Selection** — `Checkbox` select-all (current page) + per-row; selection is current-page-scoped and clears on page/filter change (as today). Checkbox click does not trigger the title link.
- **BulkBar** — rebuilt on shadcn (Buttons + count); same actions/handlers (`onClear`, `onDone` → refresh). Appears when `selected.size > 0`.
- **Pager** — shadcn buttons + "`from–to of total`"; Prev/Next disabled at bounds.

## 6. Animation (restrained)

`motion`, reduced-motion aware:
- **Staggered fade/slide-in on mount and on page change** (genuinely new content arrives).
- **No per-row stagger on filter/sort** — a calm crossfade as content swaps, preserving the existing "keep prior rows visible while re-filtering" no-flicker behavior.
- Honors `prefers-reduced-motion` (no motion when set).

## 7. Behavior preserved (do NOT change)

All of: URL state via `useSearchParams` (`q` debounced, `status`, `category`, `locale`, `tag`, `sort`); the `index.query({collection, offset, limit, sort, …filters})` seam; `index.distinctLocales()`; `PAGE_SIZE = 25`; page reset on filter/collection change; per-page selection reset on page change; the deliberate no-`setRows(null)`-on-refilter; loading (`Loading…`) and the two empty states (no-match-with-clear, none-yet). The `index-store` / query layer is **untouched**.

## 8. Component structure

Decompose `ContentList` (currently one ~280-line file) into focused units under `screens/content-list/` (or `screens/` flat, matching repo convention):

| File | Responsibility |
|---|---|
| `ContentList.tsx` | Orchestrates: state, the `index.query` effect, URL params, composes the pieces (slimmed) |
| `ListToolbar.tsx` | Search + Status/Category/Tag filters + Clear + the Columns menu |
| `ColumnsMenu.tsx` | The column-visibility `DropdownMenu`; reads/writes `localStorage` |
| `useColumnPrefs.ts` | Hook: visible-column state + persistence + the locale auto-rule |
| `ContentTable.tsx` | The `Table` (sortable headers, rows, cells, animation, selection) |
| `BulkBar.tsx` | Rebuilt on shadcn (replaces the current `BulkBar`) |
| `Pager.tsx` | The pagination control |

Move `statusBadge` + `relativeTime` to a shared location (e.g. `src/lib/status-badge.ts` / `src/lib/format.ts`) and update the dashboard imports, so dashboard + lists share one source. (Currently in `src/dashboard/`.)

## 9. Testing

- `useColumnPrefs`: defaults; toggling persists to `localStorage`; locale auto-rule (on when >1 locale).
- `ColumnsMenu`: toggling a checkbox shows/hides the column.
- `ContentTable`: renders Tags/Categories chips (≤2 + "+N", "—" when empty); category slugs resolve to names; status → correct Badge variant; Title links to the editor; sortable headers call the sort toggle.
- Locale column: absent with one locale, present with >1.
- Selection: select-all toggles current page; per-row toggle; checkbox click doesn't navigate.
- Behavior intact: filter/sort updates URL; pagination from–to-of-total; clear filters; loading + both empty states.
- Animation respects `prefers-reduced-motion`.
- Cumulative: typecheck + full suite + build green.

## 10. Non-goals

- **Author column** (deferred — needs a content-model author field + identity).
- Whole-row click-to-open (title remains the target).
- The **Media** grid (different surface, later) and the **Categories** management screen.
- Any change to the `index-store` query/data layer, or new sortable fields beyond what the index supports.
- New bulk actions beyond the current set.
