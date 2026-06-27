# Posts Query Block — Design

> Status: design / approved-to-plan (2026-06-26). A placeable, configurable `{% posts %}` block that
> queries the content collection at build and renders post cards. Static, zero-runtime, SEO-clean.
> De-risked by a spike: a Markdoc block's `.astro` can call `getCollection` at build.

## Purpose

Let an author drop a configurable post list onto any page — `{% posts collection="post"
category="recipes" limit=12 offset=0 sort="newest" layout="grid" showImage=true /%}` — to build a
blog home, an archive, or a "recent posts" section. Combined with the existing `reading.homepage`
setting (which already lets any page be the home), this is how a page "shows the blog posts" — no
hardcoded route. It is Setu's equivalent of WordPress's Query Loop block.

## Spike result (de-risking, done)

A minimal `{% posts /%}` block whose `.astro` does `await getCollection('entries')` built
successfully and rendered the real post list. Confirmed:
- A Markdoc block component **can query the content collection at build** — no prebuilt cache needed
  (unlike related-posts' `gen-relations`). Pure static, zero runtime.
- The block is **self-closing/bodyless** (`{% posts /%}`, like `{% image %}`).
- The naive query returned posts across locales (the French `Bonjour` leaked into an English page) —
  so **locale scoping is required**.

## Decisions (locked)

- **Self-closing block** under `blocks/posts/` (auto-discovered, same model as `notice`/`image`).
- **Static query at build** via `getCollection` in the block component.
- **Attributes:** `collection` (default `post`), `category`, `tag`, `locale`, `limit` (default 10),
  `offset` (default 0), `sort` (`newest`|`oldest`|`title`, default `newest`), `layout`
  (`grid`|`list`, default `grid`), `showImage` (default `true`).
- **`locale` defaults to the site default locale** (`DEFAULT_LOCALE` from `@setu/core`) with a
  per-page override. (Auto-detect of the *host page's* locale is a fast-follow that needs the
  Markdoc `Content`-variable seam — shared with related-v2; out of scope here.)
- **Pagination:** count + `offset` only. No numbered pages in this block (route-level concern).
  A static `/posts/N` archive and opt-in AJAX "load more" are separate, later features.
- **Card image:** a plain `<img>` thumbnail resolved via `PUBLIC_SETU_MEDIA` (no srcset). Responsive
  variant thumbnails are a fast-follow (needs the media-manifest reader shared into a
  block-accessible module). Functional + clean now; optimize later.
- **Query/sort/filter logic is a pure `@setu/core` function** (`selectPosts`), unit-tested; the block
  is a thin render over it — mirrors the related-posts split.

## Architecture

```
packages/core/src/posts/
  select-posts.ts          # (1) pure: filter (collection/locale/category/tag) + sort + offset/limit
blocks/posts/
  block.ts                 # (2) zod contract + editor metadata (self-closing)
  posts.astro              # (2) getCollection -> rows -> selectPosts -> render cards (grid|list)
```

### 1. `selectPosts` (pure, `@setu/core`)

```
selectPosts(rows: PostRow[], q: PostsQuery): PostRow[]
```

- `PostRow = { id: string; collection: string; locale: string; slug: string; title: string;
  date: number | null; tags: string[]; categories: string[]; featuredImage?: string }`
- `PostsQuery = { collection: string; locale: string; category?: string; tag?: string;
  sort: 'newest' | 'oldest' | 'title'; limit: number; offset: number }`
- Filters: `collection` exact, `locale` exact, `category` ∈ categories (if set), `tag` ∈ tags
  (if set). Sort: `newest` = date desc (null last), `oldest` = date asc (null last), `title` =
  title asc; all with a stable `id` tiebreak for deterministic output. Then `slice(offset, offset +
  limit)`. Pure, no I/O.

### 2. The block

`blocks/posts/block.ts`: `defineBlock({ props: <zod above>, editor: { label: 'Posts', icon, group,
keywords } })`. Bodyless/self-closing (no `slot`).

`blocks/posts/posts.astro`:
- `const rows = (await getCollection('entries')).map(toPostRow)` — map each entry to a `PostRow`
  (`id` → collection/locale/slug; `data.title`/`tags`/`categories`/`featuredImage`; `date` from
  `data.date`/`data.pubDate` if present else null).
- `const selected = selectPosts(rows, { collection, locale: localeAttr ?? DEFAULT_LOCALE, category,
  tag, sort, limit, offset })`.
- Render: a `<ul class="setu-posts setu-posts--{layout}">` of cards. Each card: when `showImage` and
  `featuredImage`, a plain `<img src={mediaBase + featuredImage}>`; then `<a href={'/' +
  entryUrlPath(ref)}>{title}</a>`. Scoped `<style>` for grid/list, using theme tokens with
  fallbacks (as `RelatedReading` does). Zero JS.
- `mediaBase = import.meta.env.PUBLIC_SETU_MEDIA ?? ''`; external (`http`) featuredImage values pass
  through unchanged.

## Testing

- **Core (`selectPosts`):** unit tests — collection/locale/category/tag filters; each sort with the
  null-date + id tiebreak; offset/limit slicing (incl. offset past the end → `[]`); composition
  (filter + sort + offset). Pure → fast/exhaustive.
- **Block render (site vitest):** a fixture page containing `{% posts limit=2 layout="grid" /%}`
  builds and renders two post cards with title links (and, for a post with a featured image, an
  `<img>`); a `{% posts category="..." /%}` scopes correctly; the default `locale` excludes a
  non-default-locale post; zero JS. (Build-in-`beforeAll` + read `dist`, like `featured.test.ts`.)

## Out of scope (later, separate)

- Route-level static numbered archive (`/posts/N` via `paginate()`) — the SEO-best full pagination.
- Opt-in AJAX "load more" progressive enhancement.
- Responsive (srcset) card thumbnails.
- Auto-detect of the host page's locale (needs the Markdoc `Content`-variable seam).
- Excerpt/date display fields (posts have no excerpt field yet).

## Touches

- `packages/core/src/posts/select-posts.ts` (+ test) — new; barrel export in `packages/core/src/index.ts`.
- `blocks/posts/block.ts`, `blocks/posts/posts.astro` — new (auto-discovered by `gen-blocks`).
- `apps/site/test/posts-block.test.ts` (+ a fixture page under `content/`) — new.
