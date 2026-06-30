# Category & tag archive pages — design

**Issues:** #152 (category archives) + #153 (tag archives) · **Area:** `area:taxonomy` / `area:theme`
**Branch:** `feat/taxonomy-archives`

## Goal

Let visitors browse posts by category and tag on the front end. Today content can be categorized and
tagged, but the site has no pages to browse by them and nothing links to such pages. This slice adds
the archive pages **and** the on-post links that make them reachable — the complete, non-skeleton
feature.

## Scope

- `/category/<slug>` and `/tag/<slug>` paginated archive pages (default locale only).
- Clickable category/tag chips on the **single post page** (`[...path].astro`) that link to those
  archives.
- **Out of scope** (future issues): top-level `/category` and `/tag` index/directory pages;
  per-locale archives; category/tag chips on post *cards* (deliberately left alone — the posts
  archive route + posts block cards are being edited by the in-flight #174, so we don't touch them).

## Non-collision boundary

To stay clear of #174 ("posts/query cards"), this branch touches **only**: two new route files, one
new shared archive component, one new chips component, and `[...path].astro` (the single post page,
which #174 does not touch). The existing posts archive (`pages/posts/[...page].astro`) and the posts
block are **not modified**. This means the card/pager markup is briefly duplicated between the posts
archive (inline) and `ArchiveList.astro`; a follow-up (after #174 lands) can refactor the posts
archive to consume `ArchiveList` and remove the duplication — tracked as a small `area:theme` issue,
not done here.

## URLs & routing

Mirrors the existing `/posts` archive exactly:

- Category: `/category/<slug>` (page 1) → `/category/<slug>/2`, `/3`, …
- Tag: `/tag/<slug>` (page 1) → `/tag/<slug>/2`, …

Each route's `getStaticPaths` (Astro `paginate`):
1. Project every `entries` collection item to a `PostRow` (the same `toPostRow` projection the posts
   archive uses — collection/locale/slug/title/date/tags/categories/featuredImage).
2. Derive the **distinct slugs that actually have published posts** in the default locale (so we only
   generate pages that have content; unknown slugs → Astro 404).
3. For each slug, `paginate(selectPosts(rows, { collection: 'post', locale: DEFAULT_LOCALE,
   category|tag: slug, sort: 'newest', limit: rows.length, offset: 0 }), { pageSize })`.

`pageSize` = Reading settings `postsPerPage` (with the existing `SETU_ARCHIVE_PER_PAGE` env override
for tests/demos), identical to the posts archive.

**Default locale only** for v1 (matches the posts archive). Per-locale archives → a future issue.

## Labels

- **Category** heading uses the human **name** from `categories.yaml` (`parseCategories`, slug→name
  map), falling back to the slug when no entry exists. A new tiny site loader (`loadCategories`)
  reads `taxonomy/categories.yaml` from the content-repo root, resolving the path exactly like
  `loadThemeOptions` does — `join(SETU_CONTENT_DIR, '..', 'taxonomy/categories.yaml')` in dev, else
  `new URL('../../../../taxonomy/categories.yaml', import.meta.url)`. Missing/malformed → `[]`
  (never throws), via `parseCategories`.
- **Tag** heading uses the tag value itself (tags are their own lowercase-canonical label).
- Headings read "Category: <name>" / "Tag: <value>".

## Components

**`packages/theme-default/ArchiveList.astro`** (new, shared by both new routes):
- Props: `page: Page<PostRow>`, `heading: string`, `basePath: string` (e.g. `/category/recipes`),
  plus the resolved `mediaBase` for image src.
- Renders the card grid (featured image + title) and the numbered pager (prev / numbers / next),
  copied from the posts-archive markup/styles. The pager already emits `rel="prev"`/`rel="next"`.
- Lives in the theme (front-end concern); the posts archive is left as-is to avoid #174.

**`packages/theme-default/TaxonomyChips.astro`** (new):
- Props: `categories: { slug: string; name: string }[]`, `tags: string[]`.
- Renders category chips linking `/category/<slug>` (showing name) and tag chips linking
  `/tag/<tag>` (showing the tag). Renders nothing when both are empty.
- Used on the single post page below the title/meta.

## Pure helpers (testable, in `@setu/core`)

To keep the routes thin and the logic unit-tested:

- `distinctCategorySlugs(rows: PostRow[], locale): string[]` and
  `distinctTagSlugs(rows: PostRow[], locale): string[]` — sorted, deduped, only slugs/tags that
  appear on a published post in `locale`. (Drives `getStaticPaths`.)
- `categoryNameMap(categories: Category[]): Map<string, string>` — slug→name (thin wrapper /
  could be inline). The route uses it to label headings and to build the chips' `name`.

(`selectPosts` already filters by `category`/`tag` — no new filtering logic needed.)

## Data flow

```
entries collection ──toPostRow──▶ PostRow[]
   │                                  │
   │ getStaticPaths                   ├─ distinctCategorySlugs / distinctTagSlugs ▶ one page set per slug
   │                                  └─ selectPosts({category|tag: slug}) ▶ paginate(pageSize)
   ▼
ArchiveList.astro(page, heading, basePath)  ──▶ card grid + pager (rel=next/prev)

single post page ([...path].astro):
   entry.data.categories(slugs) + categoryNameMap ─┐
   entry.data.tags ────────────────────────────────┴─▶ TaxonomyChips ▶ links to /category/<slug>, /tag/<tag>
```

## Error / edge handling

- Unknown slug → not generated by `getStaticPaths` → Astro's standard 404.
- A category slug present on a post but absent from `categories.yaml` → heading falls back to the
  slug (still a valid, browseable page).
- No `categories.yaml` at all → loader returns `[]`; category archives still work (slug headings),
  chips show slugs. Never throws.
- Posts with `published: false` are already excluded by the projection/`selectPosts` seam the posts
  archive uses (consistent with the rest of the site).

## Testing

- **Unit (`@setu/core`):** `distinctCategorySlugs` / `distinctTagSlugs` (dedupe, sort, locale filter,
  published-only, empty); `categoryNameMap` (slug→name, fallback). 
- **Route/render test (site):** a category page lists exactly the matching posts, paginates at
  `pageSize`, and an unknown slug yields no page; same for a tag page. Chips component renders the
  right hrefs and nothing when empty.
- **Real `astro build`:** seed a couple of categorized/tagged posts (+ a `categories.yaml`), build,
  and confirm `/category/<slug>`, `/tag/<slug>`, pagination pages, and the on-post chips' hrefs all
  generate correctly (the DoD "drive it" step).

## Topology

All build-time static prerender (Astro `getStaticPaths`) — no native deps, no filesystem at request
time, no long compute. Safe on every topology (local / Node / edge).
