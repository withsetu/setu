# Media Library (6A) — Design Spec

**Status:** Approved design, ready for implementation plan
**Date:** 2026-06-21
**Feature ID:** #6A (first slice of #6 "Media library + registry")

## Goal

Give Setu a polished, WordPress-class **media library**: a browsable `/media` screen
to find, upload, and manage previously uploaded media, plus an editor **"pick or
upload"** flow so an image can be *reused* across posts instead of re-uploaded each
time. Built on the shipped `/media/YYYY/MM/slug` key scheme (#5½).

## Scope decision

#6 originally bundled two subsystems. This spec is **6A only**:

- **6A (this spec):** browse / search / upload / delete + editor pick-or-upload.
- **6B (separate spec, next-after):** rename / move / reorganize (reference-aware).

Media items in 6A are **files**, not rich "records" — the technical facts we already
capture in the manifest (filename, dimensions, size, type, date). Alt text remains
**placement-specific** (set per-image in the editor, as today), because the same photo
means different things in different posts. Default-alt / titles / tags on media are a
later slice (see Roadmap).

## Global Constraints

- **Cloudflare-Pages / edge compatible.** No feature may assume a persistent local
  filesystem at request time or require a hosted server companion. Topology-specific
  behaviour hides behind a port.
- **Cost-safe.** No per-request fan-out over object storage (no "list + read N
  manifests" on every page-load).
- **Reuse before build.** Mirror the existing content-index infrastructure
  (`IndexPort` / `runQuery` / db-idb / db-memory) rather than inventing a parallel
  mechanism. Reuse `react-dropzone` (MIT, v15, ~11.5M weekly dl, pure-client) for
  upload ergonomics. Build only the app-specific grid (mirroring `ContentList`).
- **UX is part of done.** Polished, consistent, good-*feel* interface — type-ahead
  search, drag-anywhere upload, clear empty/error/loading states, controls consistent
  with the rest of the admin. No divergent design language.
- **Content-safety.** Deleting media that posts reference must surface a truthful
  "where-used" warning before it happens.

## Architecture overview

Three data pieces + two surfaces:

1. **Media index (browser-side, idb)** — powers the listing. Mirrors the content
   index *exactly*: rows live in IndexedDB (reusing the `db-idb` package), queried by
   a pure `runMediaQuery` modeled on `runQuery`. Hydrated from a raw "enumerate media"
   feed the API exposes (storage is to media what git is to content). The index is the
   topology-portable seam; the API stays a dumb raw feed with no query engine.
2. **Where-used reference projection (browser-side, in the content index)** — extract
   the `/media/...` keys from each post body *during content indexing*, where every
   body is already loaded. Makes "is this safe to delete?" an indexed lookup, not a
   scan.
3. **`StoragePort.list(prefix?)`** — the one port gap: needed so the API can enumerate
   media to feed the index hydration.

### Why browser-side, not API-side

The content index established the pattern: *the index lives in the browser (idb),
hydrated from a raw source reached through a port.* For content that source is git
(`GitPort`); for media it's storage (a "list media" endpoint backed by
`StoragePort.list()`). Media rows are tiny (no bodies) — the same tradeoff db-idb
already documents. Living browser-side makes the media index identical in pattern,
wiring, and scale path to content listing, and keeps both where-used and listing on the
same idb foundation. The API never runs a media query engine; it only emits the raw
feed and serves/stores bytes.

## Components

### Core (`packages/core`)

- **`media-index/types.ts`** — `MediaIndexRow` and `MediaIndexQuery`:
  ```ts
  interface MediaIndexRow {
    mediaKey: string        // '2026/06/cat' — identity
    filename: string        // original upload filename
    filenameLower: string   // for case-insensitive search
    contentType: string     // 'image/webp', etc.
    isImage: boolean        // drives thumbnail vs file-icon + type filter
    width: number | null    // from manifest; null for non-image
    height: number | null
    bytes: number           // original size
    uploadedAt: number      // epoch ms (UTC)
  }
  interface MediaIndexQuery {
    q?: string                              // filename substring
    type?: 'image' | 'all'                  // default 'all'
    sort?: { key: 'uploadedAt' | 'filename' | 'bytes'; dir: 'asc' | 'desc' }
    offset: number
    limit: number
  }
  interface MediaIndexPort {
    query(q): Promise<{ rows: MediaIndexRow[]; total: number }>
    upsert(row): Promise<void>
    upsertMany(rows): Promise<void>
    remove(mediaKey): Promise<void>
    clear(): Promise<void>
    getMeta(): Promise<MediaIndexMeta>      // { version }
    setMeta(meta): Promise<void>
  }
  ```
- **`media-index/run-media-query.ts`** — pure filter/sort/paginate, modeled line-for-
  line on `run-query.ts`. Default sort `uploadedAt` desc (newest first).
- **`media-index/media-index-service.ts`** — `rebuild()` (hydrate from the API raw
  feed → `clear` + `upsertMany`), `ensureBuilt()` (version-gated), `refresh()`
  (re-hydrate from the feed for cross-session freshness), `upsertOne` / `removeOne` on
  this session's own upload / delete, `query()`. Mirrors `index-service.ts`.
  **Cross-session correctness (stale-while-revalidate):** because another session may
  upload/delete media (multi-session is normal here), the `/media` screen and the
  editor picker render *immediately* from the cached idb rows, then `refresh()` from
  the raw feed in the background and update. The raw feed is one API call of tiny rows,
  so this is cheap; idb makes the first paint instant. This session's own mutations
  apply optimistically via `upsertOne`/`removeOne` without waiting for a refresh.
- **Reference projection** — extend the content index:
  - Add `mediaRefs: string[]` to `EntryIndexRow` (and to `ContentRow` projection).
  - A pure `extractMediaRefs(body)` that scans the **serialized markdoc body string**
    for `/media/...` occurrences and normalizes each to its bare `mediaKey`. A string
    scan (not AST-walking) deliberately catches every form at once — `{% image
    src="/media/..." %}` blocks, inline `![](/media/...)`, and any future tag that
    embeds a media URL — and is cheap. Runs on the *live* body (draft's when a draft
    exists, else committed), the same selection logic `tagsOf`/`categoriesOf` use.
  - A `referencedBy(mediaKey)` query path (mirrors tag filtering — rows whose
    `mediaRefs` contains the key).
  - Bump `INDEX_VERSION` 3 → 4 (one rebuild).

### Storage (`packages/core` + `packages/storage-local`)

- Add `list(prefix?: string): Promise<string[]>` to `StoragePort`.
- Implement in `storage-local` via a recursive `fs` walk under `dir`, honoring the
  adapter's existing traversal guards and skipping the `.meta` sidecar namespace.
  Returns storage keys (not filesystem paths).

### db adapters (`packages/db-idb`, `packages/db-memory`)

- `createIdbMediaIndexPort` — add a `media` object store to the same IndexedDB the
  content index opens (DB version bump), sharing the `openDB` plumbing; `getAll` +
  `runMediaQuery`.
- `createMemoryMediaIndexPort` — Map-backed twin.
- `runMediaIndexPortContract` — shared contract test proving both behave identically
  (mirrors `runIndexPortContract`).

### API (`apps/api`)

- **Raw media feed:** `GET /media/_index` — enumerate media via `StoragePort.list()`,
  read each manifest for dims/type, return
  `{ mediaKey, filename, contentType, isImage, width, height, bytes, uploadedAt }[]`.
  This is the hydration source, analogous to `/git/list`. No filtering/sorting/paging
  server-side — the browser index does that. **Route precedence:** register `GET
  /media/_index` *before* the `GET /media/*` serve wildcard; `_index` cannot collide
  with a real mediaKey (slugs are `[a-z0-9-]`, never leading-underscore).
- **Upload** (existing `POST /media`) already returns the manifest; the admin upserts
  the new row into the index client-side on success. No API change required beyond
  ensuring the response carries what `MediaIndexRow` needs.
- **Delete:** `DELETE /media/*` — removes original + variants + manifest from storage
  (uses the media-key helpers). The admin removes the index row on success.

### Admin (`apps/admin`)

- **`media/MediaGrid.tsx`** — the shared grid component. Props include a `mode`
  (`'manage' | 'pick'`) and an `onPick(src)` callback. Tile = lazy-loaded thumbnail
  (small variant, never the original), filename, dims, size, date. Used by both the
  screen and the editor picker.
- **`media/MediaDropzone.tsx`** — thin `react-dropzone` wrapper over the existing
  `uploadFile()`; full-area drop target + button; progress + inline errors. Shared by
  the screen, the editor picker, and (later) the gallery block.
- **`screens/Media.tsx`** — replace the placeholder: `MediaGrid` in manage mode +
  toolbar (type-ahead search, sort, type filter, URL-state — mirrors `ContentList`) +
  `MediaDropzone` + per-item detail (copy URL, view, delete-with-where-used).
- **Editor picker** — the image button opens a modal: **Library** tab (`MediaGrid` in
  pick mode → returns `/media/...` src → existing insert path) and **Upload** tab
  (`MediaDropzone` → upload → insert). `imageBlock` already resolves `/media/...` srcs
  via `resolveMediaSrc`; nothing downstream changes.
- **Wiring** — register `MediaIndexPort` + media-index-service in `store.tsx` /
  `Bootstrap.tsx` alongside the content index (same idb DB).

## Data flow

- **Open `/media`:** render from cached idb rows immediately (`ensureBuilt()` rebuilds
  if cold / version-bumped) → `query(filters)` → grid paints. In the background
  `refresh()` re-hydrates from the raw feed and updates. Thumbnails lazy-load small
  variants.
- **Upload:** dropzone → `uploadFile()` → on success `upsertOne(row)` → new tile
  appears at top. Errors inline.
- **Delete:** select → `referencedBy(mediaKey)` (content index) → if used, warn with the
  list of posts → on confirm `DELETE /media/*` → `removeOne(mediaKey)`.
- **Editor pick:** image button → modal → Library tab `query` → click → `onPick(src)` →
  insert `imageBlock`. Upload tab → same as screen upload, then insert.

## Error handling

- Upload rejected (size/type, enforced API-side): inline message, file not added.
- Upload network failure: progress resets, retryable, error shown.
- Delete: where-used warning first; storage delete and index removal ordered so a
  failure leaves a consistent state (row stays if file delete fails) and surfaces.
- Manifest-less / non-image item: generic file-icon tile, no broken thumbnail.
- Cold / version-bumped / missing index: `rebuild()` re-derives from the raw feed
  rather than crashing the screen.
- Empty states: "No media yet — drag a file here" (screen); "No matches" (search).

## Testing

- **Core (vitest):** `runMediaQuery` (filter/sort/paginate, default sort, edge cases);
  `media-index-service` (rebuild from a stub feed, upsert/remove, version gate);
  `extractMediaRefs` (image blocks + inline images, `/media/...` → mediaKey
  normalization); `referencedBy` query.
- **db:** `runMediaIndexPortContract` against both idb (fake-indexeddb) and memory
  adapters.
- **API:** `/media/list-raw` (enumerates, reads manifests, shape); `StoragePort.list()`
  local-adapter test incl. traversal guards + `.meta` exclusion; `DELETE /media/*`
  removes original + variants + manifest.
- **Admin (jsdom):** `MediaGrid` renders rows, search/sort/filter, pick-mode callback
  returns src; `MediaDropzone` happy + rejected paths; delete-with-where-used flow
  (warns, lists, confirms). **jsdom ignores CSS** (the #5b lesson) — assert visual
  states (drop highlight, selected tile) via non-CSS signals or note the gap, never
  false confidence.

## Scope boundary

**In 6A:** `MediaIndexPort` + idb/memory adapters + `runMediaQuery` + service;
`StoragePort.list()` + local impl; raw media feed endpoint; `mediaRefs` projection +
`referencedBy` (`INDEX_VERSION` 3→4); `/media` screen (grid, search, sort, filter,
drag-drop upload, copy-URL, single-item delete with where-used); editor pick-or-upload
modal reusing the grid; shared `react-dropzone` wrapper; `DELETE /media/*`.

## Roadmap (deferred = sequenced next, not shelved)

In order, each its own slice building on 6A:

1. **Bulk delete** (fast-follow) — multi-select + per-item where-used roll-up
   ("4 of 7 are in use"). The grid already multi-selects; this adds the safe bulk path.
2. **6B — rename / move / reorganize** — reference-aware. Rewrites every referencing
   post in one commit; the `referencedBy` projection built here is its foundation.
3. **Rich media records** — default alt text, title, tags on a media item; tag filter
   in the library.
4. **Edge `MediaIndexPort` adapter** (KV/D1) — when a topology needs it; the port seam
   is already in place.
5. **Gallery block** — its own feature; reuses `MediaDropzone` + `MediaGrid` picker.
