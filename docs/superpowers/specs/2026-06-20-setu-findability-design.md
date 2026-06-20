# Listing Findability — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope:** Make the admin Posts/Pages listing findable: a filter toolbar (search, status, locale, category, tag), sortable columns, and URL-persisted filter state. Built to the finished-feature bar.

## Problem & intent

The content index already projects what's needed and `runQuery` already supports search (title+slug), status, locale, and sort — but the listing UI (`ContentList`) exposes none of it; it's a fixed "updated, newest first" table. Meanwhile we just shipped categories and tags with no way to filter by them. This slice cashes that in: turn the listing into a usable finder at scale, and complete the payoff for the index + categories + tags work.

This is "Spec B" deferred from the content-index design.

## Decisions (locked in brainstorm)

- **Single-select per filter, combined with AND**, plus the search box. Pick one status, one locale, one category, one tag → the list narrows to entries matching all of them (and the search text). No multi-select / any-vs-all in this slice.
- **Tag filter is a typeahead** (reusing `distinctTags` prefix search) because tags are unbounded; status/locale/category are bounded dropdowns.
- **Filters live in the URL** (query params via react-router `useSearchParams`) — shareable, bookmarkable, survive refresh/navigation. Changing any filter resets to page 0.
- **Category filtering requires extending the index projection** to carry categories (the same pattern just shipped for tags).
- **Locale options are derived from the index** (`distinctLocales`) — the admin has no locale config; this shows only locales actually in use and stays scale-safe.

## Non-goals (deferred)

- Multi-select filters / any-vs-all semantics.
- Per-row lock indicators (a `DataPort` concern Spec B mentioned — separate slice).
- Saved/named filter views.
- Site-side category/tag archive pages (site render).
- Sorting by locale (not a `runQuery` sort key).

## Architecture

### 1. Core — project categories into the index

Mirror exactly what tags did (`setu-tags`).
- `ContentRow` (`content-index/list-entries.ts`) and `EntryIndexRow` (`index-port/types.ts`) each gain `categories: string[]`.
- A `categoriesOf(draft, committedStr)` helper (alongside `tagsOf`): draft's `metadata.categories` wins when a draft exists, else committed frontmatter `categories`. Values are taxonomy **slugs** (already canonical — no normalization), filtered to strings + deduped (first-seen order); tolerant of absent/non-array → `[]`.
- `projectRow` copies `row.categories`; `rowToContentRow` copies it back.
- **`INDEX_VERSION` bumps 2→3** so the persisted idb index auto-rebuilds and repopulates categories.

### 2. Core — query filters

- `IndexQuery` gains `tag?: string` and `category?: string` (single-select, slug-valued).
- `runQuery` adds two filters after the existing status/locale/search filters: `if (q.tag) xs = xs.filter(r => r.tags.includes(q.tag))` and `if (q.category) xs = xs.filter(r => r.categories.includes(q.category))`. All filters compose with AND (the existing reduce-by-filter chain). Sort/paginate unchanged.

### 3. Core — distinct locales

- A pure `selectDistinctLocales(rows: EntryIndexRow[]): string[]` (distinct `locale` values, sorted ascending) in `index-port/distinct-tags.ts` (or a sibling), exported from the barrel.
- `IndexPort` gains `distinctLocales(): Promise<string[]>`; `IndexService` exposes it. Both adapters delegate to `selectDistinctLocales` over their rows (memory: values; idb: `getAll`). Covered by `runIndexPortContract`. (No prefix/limit — locales are a tiny bounded set.)

### 4. Admin — filter toolbar + sortable headers in `ContentList`

`ContentList` is rewritten to drive its query from URL state and render a filter toolbar.

- **State source:** `useSearchParams`. Recognized params: `q` (search), `status`, `locale`, `category`, `tag`, `sort` (e.g. `updatedAt-desc`, `title-asc`, `status-asc`). Absent param = no filter / default sort (`updatedAt-desc`). Pagination is local state, reset to 0 whenever any param changes.
- **Query effect:** builds `IndexQuery` from the params + page, calls `index.query`. Search input is debounced (~200ms) before writing `q` to the URL.
- **Toolbar controls:**
  - Search text input (debounced).
  - Status `<select>`: "All status" + lifecycle states (`draft`, `staged`, `live`, `unpublished`).
  - Locale `<select>`: "All locales" + `index.distinctLocales()`.
  - Category `<select>`: "All categories" + categories from `useTaxonomy()`, indented by hierarchy (`buildTree`), valued by slug.
  - Tag typeahead: a small input that queries `index.distinctTags(prefix, 8)`; picking a suggestion sets `tag`; a clear (×) removes it. Reuses the editor's pattern.
  - **Clear filters** button, shown when any param is active, that resets all to default.
- **Sortable headers:** Title, Status, Updated are buttons that set `sort` and toggle asc/desc, showing a direction indicator on the active column. Locale header stays static.
- **Rows/pager:** unchanged from today (title link, view-on-site, status pill, locale, updated date, prev/next pager with "from–to of total").

### 5. States

- **Filtered-empty:** when `total === 0` but filters are active → "No {posts} match these filters." + a Clear filters action (distinct from the existing "No {posts} yet." shown when there are genuinely none).
- **Loading / index-not-built:** existing loading state; `ensureBuilt()` already runs before query.

## Data flow

- User changes a control → write the param to the URL (`setSearchParams`) → effect reads params + page → `index.query(IndexQuery)` → rows/total → table re-renders. Search is debounced before the URL write.
- Sort header click → set/toggle `sort` param → same path.
- Category options come from `useTaxonomy`; tag suggestions and locale options from the index.

## Error handling / edges

- Unknown/garbage param values (e.g. `?status=bogus`) → the query simply matches nothing (filtered-empty state); no crash. `sort` with an unrecognized key falls back to the default sort.
- Absent params → unfiltered default view (today's behavior).
- A category/tag that no longer exists still works as a filter value (matches nothing) — no special handling needed.
- `distinctLocales`/`distinctTags` on an empty index → `[]` (dropdown shows just "All").

## Testing

- **Core:** `categoriesOf` extract/dedupe/tolerance; `projectRow`/`rowToContentRow` round-trip `categories`; `runQuery` tag filter, category filter, and a combined AND case (status + category + search); `selectDistinctLocales` distinct+sorted; `distinctLocales` contract for memory + idb via `runIndexPortContract`.
- **Admin (`ContentList`):** a control writes the expected URL param and drives the query; AND of two filters narrows results; a sortable header toggles sort + indicator; Clear filters resets params; filtered-empty state renders; URL param on mount pre-populates the filter (deep-link). Render under `MemoryRouter` + `ServicesProvider` + `IndexProvider` + `TaxonomyProvider` with seeded entries.

## Sequencing (where the rest lives)

1. **This slice:** search + status + locale + category + tag filters, sortable headers, URL state, category projection, `distinctLocales`.
2. **Next, now enabled:** category counts (the projection carries categories), bulk operations (still need the multi-file `GitPort` commit foundation).
3. **Later:** multi-select filters; per-row lock indicators; saved views; site-side archive pages.
