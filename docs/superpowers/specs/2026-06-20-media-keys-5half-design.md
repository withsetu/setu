# Human-readable media keys — media slice #5½

**Date:** 2026-06-20
**Status:** approved (owner approved the design + every decision; trust-as-approval per working style)
**Sub-project:** Media **#5½** — replace the opaque `media/<uuid>/…` storage/URL scheme with
WordPress-style **date + filename** keys, and rename the public route from `/uploads/` to `/media/`.
Foundational: the media library + registry (#6) builds on this. **Owner decision** (see
[[setu-media-keys]]): URLs should be human/meaningful for SEO and the "for non-coders" feel.

## Goal

A freshly uploaded `My Cat Photo.jpg` is stored and served at **`/media/2026/06/my-cat-photo.jpg`**,
its responsive variants at `/media/2026/06/my-cat-photo-800w.webp`, and its manifest as a sidecar
`2026/06/my-cat-photo.manifest.json` — replacing today's `/uploads/media/<uuid>/original.jpg`,
`…/w800.webp`, `…/manifest.json`. The render derives the manifest straight from the content `src`.

## The key model

A stable identifier **`mediaKey = <YYYY>/<MM>/<slug>`** (UTC year/month of upload; `slug` =
sanitized original filename without extension, deduped on collision). Everything derives from it:

| Artifact | Storage key | Public URL (src) |
|---|---|---|
| original | `2026/06/my-cat-photo.jpg` | `/media/2026/06/my-cat-photo.jpg` |
| variant (per width) | `2026/06/my-cat-photo-800w.webp` | `/media/2026/06/my-cat-photo-800w.webp` |
| manifest (sidecar) | `2026/06/my-cat-photo.manifest.json` | (build-time read only, never served as a page) |

The `/media/` route IS the namespace, so the storage key drops the redundant `media/` prefix.

## Decisions (settled in brainstorm)

- **Public route + prefix = `/media/`** (was `/uploads/media/…` — a double prefix). One clean namespace.
- **Variant suffix = `-<width>w`** (e.g. `-800w`) — matches our `srcset` `800w` descriptor and the
  width-driven ladder (height is derived, so WxH would be redundant).
- **Clean break, no dual-scheme.** New scheme only; the old `media/<uuid>/…` route/keys/lookup are
  removed (pre-launch, content is throwaway). The #4c/#5a render-test fixtures are rewritten to the new
  scheme; existing dev images are re-uploaded (one-time). No transitional dual route/key/manifest debt.
- **The path is the id** (no separate registry). The manifest is derived from the `src`. A stable
  internal-id ↔ human-path registry (for rename/move/reuse) is **#6**, not built here.
- **Collisions** get a `-2`, `-3`, … suffix on the slug when that `<y>/<m>/<slug>.<ext>` original already
  exists in storage (`StoragePort.exists`) — WordPress-style.
- **UTC** year/month (deterministic, timezone-independent).
- **Applies to all media** (not just images): every upload gets a `mediaKey`; images additionally get the
  variant ladder + manifest (unchanged ingest behavior).

## Forward-design note: public/private (NOT built here)

Public media keeps **clean URLs** (`/media/<y>/<m>/<slug>` — no visibility segment, since clean URLs are
this slice's whole point). When access-controlled/private media lands (the deferred signed-URL item), it
becomes a **separate keyspace + a signed-URL serving route** (e.g. a `_private/` storage keyspace served
only through an authenticated/signed endpoint), **reusing the same `<y>/<m>/<slug>` mediaKey**. So public
stays pristine and private slots in without restructuring. Recorded; out of scope for #5½.

## Verified before designing (against the code)

- Keys are minted in `apps/api/src/media.ts` (`crypto.randomUUID()` → `media/<id>/original.<ext>`);
  `file.name` (original filename) is already in the handler; **`StoragePort.exists(key)` exists**
  (`packages/core/src/storage/storage-port.ts`) — collision-checking is supported.
- Variant/manifest keys are built in `packages/core/src/image/ingest.ts`
  (`media/<id>/w<w>.<ext>`, `media/<id>/manifest.json`); `MediaManifest` =
  `{ id, format, original:{key,…}, variants:[{width,height,key,contentType}] }`.
- `/uploads/` appears in exactly four production spots: the serving route `GET /uploads/*`
  (`media.ts:105`), the manifest regex (`media-manifest.ts:8`), the srcset builder
  (`image-markup.ts:31` → `/uploads/${v.key}`), and the api public-URL default
  (`server.ts:14` → `SETU_MEDIA_PUBLIC_URL ?? …/uploads`). `PUBLIC_SETU_MEDIA` is the origin (no path);
  `SETU_MEDIA_DIR` is the FS path the build reads manifests from.
- **Rule #2 (Cloudflare + cost):** keys are minted at upload (Node api) and read at build (static); the
  slug/key helpers are pure + edge-safe. No new per-visitor cost. The `/media/*` serving route is the
  same Node/dev path as today (the edge serves from R2/CDN later — unchanged by this).

## Architecture — units

### 1. `packages/core/src/image/media-key.ts` — pure key helpers (new, edge-safe)
```ts
/** Sanitize an upload filename into a URL-safe slug (no extension): lowercase ASCII, runs of
 *  non-alphanumerics → '-', trimmed, collapsed, capped (~60 chars). Empty/exotic → 'file'. */
export function mediaSlug(filename: string): string

/** Assemble a mediaKey from UTC parts + slug: `${yyyy}/${mm}/${slug}` (mm zero-padded). */
export function mediaKeyOf(yyyy: number, mm: number, slug: string): string

/** Variant storage key for a width: `${mediaKey}-${width}w.${ext}`. */
export function variantKey(mediaKey: string, width: number, ext: string): string

/** Original/manifest storage keys: `${mediaKey}.${ext}` and `${mediaKey}.manifest.json`. */
export function originalKey(mediaKey: string, ext: string): string
export function manifestKey(mediaKey: string): string
```
- `mediaSlug('My Cat Photo.jpg')` → `my-cat-photo`; `'  ©.png'` → `file`; strips the extension first.
- These are pure → unit-tested, and importable by both the api (Node) and core ingest (edge-safe).

### 2. `apps/api/src/media.ts` — mint human keys + serve `/media/*` (modify)
On `POST /media`:
```ts
const now = new Date()
const slug = mediaSlug(file.name)
const ext = EXT_BY_TYPE[file.type] ?? 'bin'
let mediaKey = mediaKeyOf(now.getUTCFullYear(), now.getUTCMonth() + 1, slug)
for (let n = 2; await storage.exists(originalKey(mediaKey, ext)); n += 1) {
  mediaKey = mediaKeyOf(now.getUTCFullYear(), now.getUTCMonth() + 1, `${slug}-${n}`)
}
const key = originalKey(mediaKey, ext)            // 2026/06/my-cat-photo.jpg
await storage.put(key, bytes, { contentType: file.type })
// images → ingest with the mediaKey; response { id: mediaKey, key, url: storage.url(key), … }
```
- `ingestImage` is called with the `mediaKey` (replacing the old `id`).
- The serving route becomes `GET /media/*`: `const key = decodeURIComponent(c.req.path.slice('/media/'.length))`,
  guarded against `..` path traversal (reject any segment === `..`), then `storage.get(key)`.

### 3. `apps/api/src/server.ts` — public-URL default (modify)
`SETU_MEDIA_PUBLIC_URL ?? \`http://localhost:${port}/media\`` (was `/uploads`).

### 4. `packages/core/src/image/ingest.ts` — variant/manifest keys (modify)
Take `mediaKey` instead of `id`; build `variantKey(mediaKey, w, ext)` and write the manifest to
`manifestKey(mediaKey)`; `manifest.id = mediaKey`, `original.key = originalKey(mediaKey, origExt)`.
(Variant naming `w<w>` → `-<w>w`; everything else — never-upscale, dedupe, ascending — unchanged.)

### 5. `apps/site/src/lib/media-manifest.ts` — derive the manifest from the src (modify)
```ts
/** mediaKey for a root-relative `/media/<y>/<m>/<slug>.<ext>` src; null for external/non-media. */
export function manifestKeyFromSrc(src: string): string | null   // strip `/media/` prefix + extension
/** Read `${SETU_MEDIA_DIR}/<mediaKey>.manifest.json`; null on unset env / missing / bad JSON. */
export function loadManifest(mediaKey: string): MediaManifest | null
```
- `manifestKeyFromSrc('/media/2026/06/my-cat-photo.jpg')` → `2026/06/my-cat-photo`;
  external `http(s)://…` or non-`/media/` → null.
- `loadManifest` reads `join(dir, `${mediaKey}.manifest.json`)`.

### 6. `apps/site/src/lib/image-markup.ts` — srcset prefix (modify)
`resolveUrl(\`/media/${v.key}\`)` (was `/uploads/${v.key}`). The variant `key` is already the full
storage key (`2026/06/…-800w.webp`), so this yields `/media/2026/06/…-800w.webp`.

### 7. `Image.astro` (modify, minimal)
Rename the calls `manifestIdFromSrc`→`manifestKeyFromSrc`, `loadManifest(id)`→`loadManifest(key)`. The
`resolveUrl` (root-relative → `PUBLIC_SETU_MEDIA` origin) is unchanged — it already prepends the origin to
any `/…` path, so `/media/…` resolves correctly.

## Data flow
```
upload "My Cat Photo.jpg" (image/jpeg) →
  slug 'my-cat-photo'; mediaKey '2026/06/my-cat-photo' (or '-2' if taken) →
  store 2026/06/my-cat-photo.jpg ; ingest → 2026/06/my-cat-photo-800w.webp … + 2026/06/my-cat-photo.manifest.json →
  response url http://host/media/2026/06/my-cat-photo.jpg → editor stores src "/media/2026/06/my-cat-photo.jpg"
render: manifestKeyFromSrc(src) '2026/06/my-cat-photo' → loadManifest → <img srcset="/media/2026/06/my-cat-photo-800w.webp 800w …">
```

## Error handling / edge cases
- Unknown content-type → `ext = 'bin'`; non-image → stored, no manifest (unchanged).
- Empty/exotic filename → `mediaSlug` returns `file`; collisions still deduped (`file-2`, …).
- Collision loop probes the **original** key; variants/manifest derive from the deduped mediaKey, so they
  can't collide across distinct originals.
- `loadManifest`/`manifestKeyFromSrc` never throw (unset env / missing / external src → null → plain `<img>`).
- Path-traversal guard on `/media/*` (reject `..` segments) — same safety the old `media/`-prefix guard gave.

## Testing
- **`media-key` (pure unit, core):** `mediaSlug` (spaces/case/punct/unicode/empty → `file`/length cap);
  `mediaKeyOf` (zero-padded month); `variantKey`/`originalKey`/`manifestKey` exact strings.
- **api `media.ts`:** upload of `Cat.JPG` → key `<yyyy>/<mm>/cat.jpg`, response `id` = that mediaKey,
  `url` ends `/media/<yyyy>/<mm>/cat.jpg`; a second `Cat.jpg` in the same month → `cat-2.jpg` (mock/stub
  `storage.exists` to force one collision); `GET /media/<key>` serves the bytes and rejects a `..` key.
- **core `ingest`:** variant keys `<mediaKey>-<w>w.<ext>`, manifest at `<mediaKey>.manifest.json`,
  `manifest.id === mediaKey` (update the existing ingest test fixtures/assertions).
- **site `media-manifest`/`image-markup`:** `manifestKeyFromSrc` extracts the key / returns null for
  external; `loadManifest` reads a `<key>.manifest.json` written to a tmp `SETU_MEDIA_DIR`; the srcset
  builder emits `/media/<key>-<w>w.<fmt>`.
- **site render (`render.test.ts`):** rewrite the fixture to the new scheme — kitchen-sink image
  `/media/2026/06/test-cat.jpg`, the `beforeAll` writes `2026/06/test-cat.manifest.json` (+ variants)
  to the tmp dir; assert `<figure>`/`<img srcset="…/media/2026/06/test-cat-800w.webp 800w…">`. Update the
  `{% image %}` block fixture src too.
- Full repo `pnpm -r test` + `pnpm -r typecheck` green.

## Out of scope (later — roadmap)
The id↔path **registry** + media-library UI (#6); rename/move (needs the registry indirection);
**public/private** keyspaces + signed URLs (forward-note above); migrating any real (post-launch) content;
AVIF/#4f; the editor-fidelity/#5d and turn-into-block/#5c image work.

## Success criteria
Uploading `My Cat Photo.jpg` yields `/media/2026/06/my-cat-photo.jpg` (and `-800w.webp` variants), the
content stores that human `src`, the built site renders the responsive figure by deriving the manifest
from the src, a same-name re-upload becomes `…-2.jpg`, and `/media/*` serves the bytes (rejecting `..`).
No `/uploads/` or `media/<uuid>/` paths remain. All tests green + typecheck.
