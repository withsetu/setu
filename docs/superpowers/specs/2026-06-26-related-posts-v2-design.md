# Related Posts v2 — Configurable + Block — Design

> Status: design / approved-to-plan (2026-06-26). Turns the v1 auto-appended "Read Next" into a
> configurable component (site setting + per-post frontmatter override + featured-image cards) and
> adds a placeable `{% related %}` block for manual in-body curation. Builds on the shipped
> related-posts v1, featured image, and the query-block card render. No new render seam required.

## Purpose

Give authors control over related posts: **automatic by default** (auto-append, now configurable via
a site setting — on/off, heading, count, show-image), **manual override per post** (frontmatter pin a
curated list or turn it off), and a **placeable `{% related %}` block** to drop a curated list
anywhere in the body. The "show featured image or not" the owner asked for is the headline addition.

## Decisions (locked)

- **Site setting** `reading.relatedPosts: { enabled, heading, count, showImage }` (defaults: `enabled
  true`, `heading 'Read Next'`, `count 3`, `showImage true`). Controls the auto-append.
- **Per-post frontmatter override** (decision (a), the "manual override"): `related: false` → no
  related section; `related: [slug-a, slug-b]` → those posts (in order) instead of the computed
  graph; absent → computed graph (v1 behavior). Slugs resolve within the post's collection + locale.
- **Featured-image cards:** when `showImage`, each related item renders the related post's featured
  image as a thumbnail (reusing the query-block card style) + title; else title-only (v1 look).
- **`{% related %}` block:** `blocks/related/` — `posts="slug-a,slug-b"` (required, ordered),
  optional `heading`, `showImage`, `locale`. Renders the named posts as cards. For in-body manual
  placement. Same card render as the query block.
- **No host-id seam needed:** auto-append is app-driven (the route already knows the entry id); the
  block is pin-only. **In-body auto-compute** (`{% related /%}` resolving the host's graph at a body
  position) stays **deferred** — it is the only part needing the Markdoc `Content`-variable seam.
- **Suppression:** out of scope for v2 — placing an in-body `{% related %}` block does not
  auto-suppress the bottom auto-append. Authors who want only the in-body one set `related: false`
  in frontmatter. (Stated, not discovered.)

## Architecture

```
packages/core/src/settings/            # (1) add relatedPosts to ReadingSettings (types/defaults/schema)
scripts/gen-relations.mjs              # (2) enrich refs with featuredImage; honor frontmatter override
packages/theme-default/RelatedReading.astro  # (3) heading + showImage cards
apps/site/src/pages/[...path].astro    # (3) thread settings (enabled/count/heading/showImage); resolve image src
blocks/related/                        # (4) {% related posts=… %} pinned block
```

### 1. Settings (`@setu/core`)

Add to `ReadingSettings`: `relatedPosts: { enabled: boolean; heading: string; count: number;
showImage: boolean }`. Add the matching defaults and a `partial()` zod sub-schema merged in
`parseSettings` (same pattern as `feed`/`markdown`). Round-trips through the Git-backed `settings.json`
transparently.

### 2. gen-relations — enrich + override

- `toRow` also captures `featuredImage` (string `/media/…` or undefined) and the `related` override
  (`false` | `string[]` | undefined) from frontmatter.
- The output ref shape becomes `{ title, href, featuredImage? }`.
- `buildRelationsGraph`: for each entry — `related === false` → `[]`; `related` is an array → resolve
  each slug to a same-collection+locale row → ref (in the given order); else → the computed
  `selectRelatedPosts` graph (v1). All refs are enriched with the target post's `featuredImage`.
- Still computes up to a fixed max (`k = 6`) so the render layer can slice to any configured
  `count ≤ 6`.

### 3. RelatedReading + route wiring

- `RelatedReading` props: `heading?: string` (default `'Read Next'`), `showImage?: boolean`,
  `related?: { title; href; image? }[]`. Renders a card per item: when `showImage && image`, a
  thumbnail `<img>` (query-block card style) above the title link; else the v1 title list. Configurable
  `<h2>` text. Zero JS.
- `[...path].astro`: read `siteSettings.reading.relatedPosts`. When `enabled === false` → pass
  `related={[]}` (no section). Else slice the cached refs to `count`, resolve each `featuredImage`
  `/media` value to a display src via `PUBLIC_SETU_MEDIA`, and pass `related` + `heading` + `showImage`
  to `PostLayout` → `RelatedReading`.
- `PostLayout` forwards the new `heading`/`showImage` props.

### 4. `{% related %}` block

`blocks/related/{block.ts,related.astro}` — props `posts` (z.string, comma-separated slugs, required),
`heading` (default `'Related'`), `showImage` (default true), `locale` (optional, default
`DEFAULT_LOCALE`). `related.astro`: `getCollection('entries')`, resolve each `posts` slug to
`post/<locale>/<slug>`, in order, to a card row (title + href + featuredImage); render with the same
card markup/CSS as the query block. Self-closing `{% related posts="a,b" /%}`. Reuses the
`@setu/core` resolver clause added for the query block.

## Testing

- **Core settings:** `parseSettings` fills `relatedPosts` defaults; a partial override merges; an
  unknown future key is preserved (existing passthrough test pattern).
- **gen-relations:** a fixture with `related: false` → `[]`; `related: [slug]` → that pinned ref (with
  its `featuredImage`); a normal post → computed refs each carrying `featuredImage` when the target
  has one. (`node:test`, extends the existing `gen-relations.test.mjs` style.)
- **Render (site vitest):** a post renders image-card related items (thumbnail + title) under the
  configured heading when `showImage`; with a settings fixture `enabled:false` → no related section;
  `{% related posts="…" /%}` on a page renders the named posts as cards in order. (Build-in-`beforeAll`
  + read `dist`, like `featured.test.ts`/`posts-block.test.ts`.)

## Out of scope (later)

- In-body **auto-compute** `{% related /%}` (needs the Markdoc `Content`-variable host-id seam).
- Auto-suppression of the bottom auto-append when an in-body block is present.
- Per-post heading/count override in frontmatter (settings-level only for v2).

## Touches

- `packages/core/src/settings/{types,defaults,schema}.ts` (+ tests).
- `scripts/gen-relations.mjs` (+ `scripts/gen-relations.test.mjs`).
- `packages/theme-default/RelatedReading.astro`, `PostLayout.astro`; `apps/site/src/pages/[...path].astro`.
- `blocks/related/{block.ts,related.astro}`; `apps/site/test/` render tests + fixtures.
