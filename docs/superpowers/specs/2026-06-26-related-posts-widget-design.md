# Related Posts Widget — Design

> Status: design / approved-to-plan (2026-06-26). A pre-built related-content graph computed
> at build time, consumed O(1) at render. Static-first, zero-JS, Cloudflare-Pages-safe.

## Purpose

Give every post a "Read Next" widget listing its most-related sibling posts. The relationship
graph is **pre-computed once at build time** and written to a static lookup map; the render-time
component does a single O(1) map read and emits plain `<a>` links into the static HTML — so the
internal links are crawlable for SEO and cost nothing at runtime.

## The core decision: ride the existing index, don't re-parse content

A related-posts graph needs each entry's `tags`, `categories`, `locale`, `collection`, `title`,
`status`, and `updatedAt`. Setu **already** derives exactly this — `EntryIndexRow` in
`packages/core/src/index-port/types.ts`, with selectors like `selectEntriesByTag`, `tagCounts`,
and `runQuery` sitting beside it. Related-posts is therefore **a projection over data the system
already parses**, not a new content-ingestion pipeline.

Concretely this rejects the "native Rust binary that memory-maps `.mdoc` and byte-scans frontmatter"
approach, for reasons that hold up under scrutiny:

- **Language ≠ complexity.** A naive all-pairs comparison is O(N²) regardless of language. Rust
  shrinks the constant; it does not move the wall. At 100k posts, all-pairs is ~10^10 comparisons —
  ~100s *even in Rust*. The scalability fix is **algorithmic** (inverted-tag-index candidate
  generation → near-linear for sparse tag overlap), and that is language-independent and cheap in TS.
- **It is not the bottleneck.** The graph step is sub-second for thousands of posts inside an
  `astro build` that already takes tens of seconds. Optimizing it with native code is optimizing a
  rounding error.
- **True cost.** A Rust path means a cargo toolchain, cross-compiled CI binaries, per-platform npm
  packages, *and* a TypeScript fallback (which must be written anyway) — two implementations to keep
  in sync, for a tag-set intersection. Fails the build-vs-reuse bar.
- **Pattern consistency.** The scoring logic lives in `@setu/core` next to the other index
  selectors, reusable by both the admin index and the site build — one source of truth.

## Architecture — four units

```
@setu/core
  index-port/related-posts.ts     # (1) pure scorer: rows -> related map
scripts/
  gen-relations.mjs               # (2) build step: content -> .setu/cache/relations.json
@setu/theme-default
  RelatedReading.astro            # (3) pure render component (O(1) lookup)
  PostLayout.astro                # (4) mount point
```

### 1. Pure scorer — `@setu/core/index-port/related-posts.ts`

```
relatedPosts(rows: RelatedRow[], opts: RelatedOpts): Record<string, RelatedRef[]>
```

- **Input** `RelatedRow` — a minimal subset of `EntryIndexRow`: `{ key, collection, locale, slug,
  title, tags, categories, updatedAt }`. (Reuses the existing `indexKey(ref)` for `key`/lookup id.)
- **Scope filter (decisions 3):** candidates are restricted to the **same `collection` and same
  `locale`** as the source, and the source excludes itself.
- **Candidate generation (the scalability core):** build an inverted index `tag -> rows`. For each
  source row, the candidate set is the union of rows sharing ≥1 tag — never the full corpus. This is
  near-linear for realistic (sparse) tag distributions and avoids the O(N²) all-pairs wall.
- **Scoring:** for each candidate, `score = jaccard(tags) + categoryBoost * jaccard(categories)`,
  where `jaccard(A,B) = |A∩B| / |A∪B|` (0 when both empty). `categoryBoost` is a small constant
  (default `0.25`) so shared tags dominate but a shared category breaks ties upward.
- **Tiebreak:** equal scores resolve by **recency** (`updatedAt` desc), then by `key` for
  determinism (stable output across builds — important for clean diffs and reproducible deploys).
- **Top-K (decision 2):** keep the top `k` (default **4**) per source.
- **Graceful fallback (decision 4a):** if a source has fewer than `k` tag-based matches, fill the
  remainder from (a) same-category entries, then (b) most-recent entries in the same
  collection+locale — so the widget is **never empty**. Fallback entries are clearly lower-ranked
  than any genuine tag match (they only fill unused slots).
- **Output:** `Record<rowKey, RelatedRef[]>` where `RelatedRef = { collection, locale, slug, title }`.
  Resolved `title` is included so downstream consumers need no second lookup. (`href` is **not**
  computed here — it depends on the site's permalink util, which is app-side; `gen-relations`
  enriches each ref with `href` in unit 2.)
- **Purity:** no I/O, no clock (recency uses the row's `updatedAt`, passed in). Fully unit-testable.
  This is the **swap seam for embeddings later** — a future `relatedPostsByEmbedding(rows, vectors,
  opts)` has the same output shape; nothing downstream changes.

### 2. Build step — `scripts/gen-relations.mjs`

A direct twin of the existing `scripts/gen-blocks.mjs` (same `jiti` + `createRequire` trick to
import `@setu/core` from `packages/core`, same `prebuild` lifecycle).

Pipeline:
1. Resolve the content base the same way the site does: `SETU_CONTENT_DIR ?? '<root>/content'`.
2. Glob `**/*.mdoc`. For each file, parse YAML frontmatter for `title`, `tags`, `categories`, and a
   date field for `updatedAt` (frontmatter date if present, else file mtime). Derive
   `collection/locale/slug` from the path (`post/en/slug` convention — same as `entry.id`).
   *Note:* on-disk site content is all published, so no lifecycle/`status` computation is needed
   here (that machinery is admin-side); every on-disk entry is a live candidate.
3. Build `RelatedRow[]`, call `relatedPosts(rows, { k: 4, categoryBoost: 0.25 })`.
4. For each `RelatedRef`, compute `href` using the site's shared permalink util
   (`apps/site/src/lib/url.ts`) so URL logic stays single-sourced (default locale unprefixed,
   matching the rest of the site).
5. Write `.setu/cache/relations.json` — a flat map `{ "<collection>/<locale>/<slug>":
   [{ title, href }, ...] }`, keyed by the Astro content-collection entry id. `.setu/` is already
   gitignored; the file is a derived build artifact, never committed. Each value carries only what
   the widget renders (`title`, `href`) — no second lookup needed anywhere.

Wiring in `apps/site/package.json`:
- `"genrelations": "node ../../scripts/gen-relations.mjs"`
- `"prebuild": "node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs"`
- `"predev"` likewise; the root `dev` watch can regenerate on content change (best-effort; a stale
  graph in dev is cosmetic).

### 3. Component — `@setu/theme-default/RelatedReading.astro`

```
---
const { related = [] } = Astro.props   // related: { title, href }[]
---
{related.length > 0 && (
  <aside class="related-reading">
    <h2>Read Next</h2>
    <ul>{related.map(r => <li><a href={r.href}>{r.title}</a></li>)}</ul>
  </aside>
)}
```

Pure render: **zero** disk scans, **zero** content-API calls, **zero** JS shipped. Because
`gen-relations` already resolved `title` + `href`, the component never touches `astro:content` —
sidestepping the `getEntries` / `.id`-vs-`.slug` API pitfalls. Styled via existing theme tokens.

**Decoupling decision:** the component receives its pre-resolved `related` array as a **prop** — it
does *not* import the cache file. This keeps `@setu/theme-default` ignorant of the app's
`.setu/cache` location. The O(1) lookup happens in the app (unit 4), not the theme package.

### 4. Mount — page → `PostLayout` → component

`apps/site/src/pages/[...path].astro` already knows the entry id it is rendering. There it imports
the generated map (`import relations from '../../.setu/cache/relations.json'`), does the single O(1)
lookup `relations[entryId] ?? []`, and passes the result down: `<PostLayout related={...}>`, which
forwards it to `<RelatedReading related={...} />` after the `<article>` slot. The app owns the cache
import; the theme owns only rendering.

## Cloudflare Pages & the rebuild question

- **Runtime cost: zero.** Links are baked into static HTML at build; no per-request work, no
  function invocation. Cost-safe by construction.
- **Build cost: a sub-second prebuild step**, no native dependencies — runs in CF Pages' standard
  Node build container exactly like `gen-blocks`. Pages-safe by construction.
- **"Does it force a whole-site rebuild?"** Related-posts is a *graph*: editing one post can shift
  the "Read Next" list on its neighbors, so the set of stale pages after one edit is the edited page
  **plus its neighbors**. On the **current Cloudflare Pages static topology this is a non-issue**:
  every deploy already runs a full `astro build` and re-renders 100% of pages (CF Pages has no
  partial static builds). The fan-out is invisible — everything re-renders regardless — and
  related-posts adds only the cheap graph step. **No incremental-rebuild infrastructure is required
  for this feature.**

### Stated non-goals / future (out of scope)

- **Incremental deploys (ISR-style).** Only if/when Setu pursues re-rendering *only changed pages*
  at six-figure scale does the graph fan-out matter. Known answers for that day: recompute only the
  affected neighbor set (the scorer can report which source keys changed), or hydrate the widget
  client-side from a redeployed `relations.json` (trading away zero-JS/SEO purity). Not built now.
- **Embeddings / semantic relatedness.** The HORIZON model — embed each post once at build, rank by
  cosine similarity — finds related posts that share zero tags. Deferred; the pure-scorer seam (unit
  1) is designed so it swaps in with no downstream change.
- **Incremental graph computation.** Full recompute each build is sub-second for thousands of posts;
  not worth incrementalizing. (The admin content-index is separately incremental; this site-build
  projection is a cheap full recompute.)
- **Cross-locale / cross-collection relations, manual "related" overrides, per-post pinning.** Not in
  v1.

## Slicing (decision 5 — my call: 3 independently-shippable slices)

1. **Slice A — pure scorer in `@setu/core`** (`related-posts.ts` + unit tests). Inverted-index
   candidate gen, Jaccard + category boost, recency tiebreak, top-K, graceful fallback. No site
   wiring. Fully testable in isolation; merges on its own.
2. **Slice B — build step** (`gen-relations.mjs` + `prebuild`/`predev` wiring + `.setu/cache`
   output). Produces a real `relations.json` from `content/`. Verifiable by inspecting output; no
   visible UI yet.
3. **Slice C — widget + mount** (`RelatedReading.astro`, the `[...path].astro` cache import + O(1)
   lookup, `PostLayout` prop pass-through, theme styles, render tests). The visible "Read Next"
   feature.

## Testing

- **Slice A:** unit tests for jaccard math, candidate scoping (same collection+locale, self-excluded),
  ranking/tiebreak determinism, top-K truncation, and each fallback tier (tag-thin, category-only,
  recency fill, empty-corpus). Pure functions → fast, exhaustive.
- **Slice B:** a fixture content dir → assert the emitted `relations.json` shape, keys, resolved
  `href`s, and that a known post yields the expected neighbors.
- **Slice C:** extend `apps/site` render tests — a post page renders the `<aside class=
  "related-reading">` with the expected links baked into the static HTML; a post with no relations
  renders no widget (or the fallback, never broken markup).
- **Full repo:** existing site/theme/core suites stay green; build stays zero-JS.

## Touches

- `packages/core/src/index-port/related-posts.ts` (+ test) — new.
- `scripts/gen-relations.mjs` — new; mirrors `gen-blocks.mjs`.
- `apps/site/package.json` — `prebuild`/`predev`/`dev` script wiring.
- `apps/site/src/lib/url.ts` — reused for `href` derivation (no change expected).
- `apps/site/src/pages/[...path].astro` — import the cache, O(1) lookup, pass `related` prop.
- `packages/theme-default/RelatedReading.astro` — new; `PostLayout.astro` — forward `related` prop.
- `.setu/cache/relations.json` — derived artifact (gitignored).
