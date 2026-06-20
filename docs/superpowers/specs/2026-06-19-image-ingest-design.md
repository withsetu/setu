# Generate-on-upload + persist variants + manifest — media slice #4b

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** Media/Images **#4b** — wires the shipped `ImagePort` (#4a) into the upload service
(#2) so an uploaded image yields a persisted, responsive **single-format** width ladder + a manifest.
The "store-once" payoff: generate variants ONCE → persist to `StoragePort` → serve static later (#4c).

## Goal

When an image is uploaded, generate a responsive width ladder in **one config-chosen format** (WebP or
AVIF — the admin's choice), persist each variant to `StoragePort` under `media/<id>/<wNNN>.<ext>`, and
write a **manifest** at `media/<id>/manifest.json` describing the original + variants. The original is
always kept (canonical bytes + fallback). No render yet (that's #4c).

## The decisions this rests on (settled in brainstorm)

- **ONE format, the admin's choice — NOT both.** `imageFormat: 'webp' | 'avif'` (default **`webp`**:
  fast + ~98% support; AVIF is ~50% smaller but slow to encode). One format → one ladder → half the
  variants → a plain `srcset` render in #4c (no multi-source `<picture>`). The **original is always
  kept** as the canonical bytes and the ultimate fallback. The WebP↔AVIF latency tradeoff now belongs
  to whoever sets the config (WebP → snappy uploads; AVIF → they opted into slower generation, which
  #4f's queue relieves).
- **Site-level config now; per-image override is #4e.** `imageFormat`/`imageWidths` are a site-level
  setting this slice; a per-image format/quality override is the natural home for #4e.
- **Synchronous generation at upload.** Simplest; queued/batch is #4f (and is where AVIF's slow encode
  belongs). A WebP ladder adds ~tens of ms; an AVIF ladder is the admin's opted-in cost.
- **On generation failure, keep the original; return it WITHOUT a manifest.** The cardinal value is
  "the upload succeeded." A corrupt-but-content-type-valid image that sharp can't process leaves the
  original stored and usable as a plain `<img>`; variants just don't exist. Log a warning; don't fail
  the request.

## Verified before designing (standing rules)

- **Rule #1 (read source):** confirmed against the repo —
  - The upload handler `apps/api/src/media.ts` `createUploadApi({ storage, resolveActor, limits? })`
    stores `media/<uuid>/original.<ext>` and returns `{ id, key, url, contentType, size, filename }`.
    This slice adds variant generation right after the original `storage.put`.
  - `@setu/core` exports `ImagePort` (`metadata` + `generate`), `VariantSpec`, `GeneratedVariant`,
    `ImageFormat`; `@setu/image-sharp` exports `createSharpImageAdapter()`; `@setu/storage-local` is
    wired in `apps/api/src/server.ts` (`createLocalStorage`). `@setu/image-testing` exports
    `makeTestPng(w,h)` (a real PNG fixture) — reusable as the api e2e fixture.
  - `media.ts` has a content-type→ext `EXT_BY_TYPE` map (the **allowlist**, content-type keyed,
    includes non-images) — that stays. The **#4a forward note** is about a *different* map: the
    `Record<ImageFormat, string>` `CONTENT_TYPE` duplicated in `@setu/image-sharp` and
    `@setu/image-testing` — this slice centralizes that (`contentTypeFor`) + adds `extensionFor`
    (`jpeg→jpg`) in `@setu/core`, and refactors the two image packages to consume them.
- **Rule #2 (Cloudflare + cost):**
  - The `ingestImage` service is **edge-safe** — pure orchestration over the injected `ImagePort` +
    `StoragePort` (no Node/DOM; `TextEncoder`/`JSON` are universal). It lives in `@setu/core/src/image`
    (already under the edge guard from #4a). The Node-only sharp adapter is injected at the api edge.
  - **Store-once:** variants are generated ONCE at upload and persisted as static objects — **zero
    per-render/per-visitor cost** (the render in #4c serves the static files). The width ladder is
    **capped at the source width (never upscaled)** and deduped, so storage stays bounded.

## Architecture — three units

### 1. `@setu/core` — `ingestImage` service + manifest type + format helpers (`src/image/`)
- **`extensionFor(format: ImageFormat): string`** → `format === 'jpeg' ? 'jpg' : format`.
- **`contentTypeFor(format: ImageFormat): string`** → `` `image/${format}` ``.
- **`MediaManifest`** type:
  ```ts
  export interface ManifestVariant { width: number; height: number; key: string; contentType: string }
  export interface MediaManifest {
    id: string
    format: ImageFormat                                   // the variant format
    original: { key: string; width: number; height: number; format: string }
    variants: ManifestVariant[]                           // ascending width
  }
  ```
- **`ingestImage(deps, input): Promise<MediaManifest>`** — `deps: { image: ImagePort; storage:
  StoragePort }`; `input: { id: string; bytes: Uint8Array; originalKey: string; originalContentType:
  string; format: ImageFormat; widths: number[] }`. (The caller has already stored the original.)
  1. `meta = await image.metadata(bytes)` — intrinsic `{ width, height, format }`.
  2. **Effective widths** = `unique(widths.filter(w => w < meta.width))` ∪ `{ meta.width }`, ascending
     — so no spec exceeds the source (no upscaling, no clamping/dupes; the largest variant = source
     width).
  3. `specs = effectiveWidths.map(w => ({ name: \`w${w}\`, width: w, format }))`.
  4. `variants = await image.generate(bytes, specs)`.
  5. **Persist** each: `storage.put(\`media/${id}/w${v.width}.${ext}\`, v.body, { contentType })`
     (`ext = extensionFor(format)`, `contentType = contentTypeFor(format)`).
  6. Build the `MediaManifest` (original from `meta` + `originalKey`/`originalContentType`'s declared
     source format; variants from the generated outputs).
  7. **Persist the manifest:** `storage.put(\`media/${id}/manifest.json\`, new
     TextEncoder().encode(JSON.stringify(manifest)), { contentType: 'application/json' })`.
  8. `return manifest`.
- One responsibility — "ingest this image into storage, return its manifest" — reusable by a future
  queued/batch ingest (#4f).

### 2. `@setu/image-sharp` + `@setu/image-testing` — consume the core helpers
Replace each package's local `CONTENT_TYPE: Record<ImageFormat, string>` with `contentTypeFor` from
`@setu/core` (no behaviour change; deletes the duplication the #4a review flagged).

### 3. `@setu/api` — wire generation into the upload handler
- `server.ts` injects `createSharpImageAdapter()` and an image config into `createUploadApi`.
- `createUploadApi({ storage, resolveActor, limits?, image?, imageConfig? })`:
  - `image?: ImagePort` (when absent — e.g. a storage-only deployment — generation is skipped).
  - `imageConfig?: { format: ImageFormat; widths: number[] }`, default
    `{ format: 'webp', widths: [400, 800, 1200, 1600] }`.
  - **`GENERATABLE`** = `new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])` — **gif is
    excluded** (animated; original kept as-is).
  - After the original `storage.put`: if `image` is present and `GENERATABLE.has(file.type)`, call
    `ingestImage({ image, storage }, { id, bytes, originalKey: key, originalContentType: file.type,
    format: imageConfig.format, widths: imageConfig.widths })` inside a `try`; on success include
    `manifest` in the 201 response; on throw, `console.warn` and return the original **without**
    `manifest`. Non-generatable types: no manifest.
- `server.ts` reads `SETU_IMAGE_FORMAT` (`webp`|`avif`, default `webp`) for `imageConfig.format`;
  widths keep the default (full `setu.config`/theme-declared sizes wiring is a later refinement — the
  config is injectable so that connect is non-breaking).

## Data flow

```
POST /media → store media/<id>/original.<ext>
  generatable image + image port present?
    └─ ingestImage: metadata → effective widths (≤ source, deduped) → generate(specs in `format`)
         → put media/<id>/w400.<ext> … w1600.<ext>  + put media/<id>/manifest.json
  201 { id, key, url, contentType, size, filename, manifest? }     (non-image/gif/failure → no manifest)
```

## Error handling

- **Generation failure** (sharp can't decode despite a valid content-type) → original stays stored;
  `console.warn`; 201 returns the original with **no `manifest`** (never fail the upload for this).
- **No image port injected** → generation skipped silently (storage-only mode); original returned.
- **Source smaller than the smallest ladder width** → a single variant at the source width (the
  effective-widths rule guarantees no upscaling).
- A non-generatable upload (pdf/gif/etc.) → original only, no manifest (expected, not an error).

## Testing

- **`ingestImage` (core)** — with an **in-memory `StoragePort` fake** + a **stub `ImagePort`** (returns
  canned variants echoing the spec widths; `metadata` returns a configured source size; **no sharp
  dependency in core tests**): asserts the persisted variant keys (`media/<id>/w<width>.<ext>`), the
  manifest shape + `original`/`variants` contents, **no-upscale + dedup** of widths (a source narrower
  than some ladder widths yields only `≤ source` widths + the source width), and the manifest is
  persisted at `media/<id>/manifest.json` with `application/json`.
- **Format helpers (core)** — `extensionFor` (`jpeg→jpg`, others identity) + `contentTypeFor`.
- **`@setu/api` e2e** — with the **real `createSharpImageAdapter()` + `createLocalStorage` (tmp dir)**
  and a `makeTestPng`-generated PNG: upload → assert the variant objects + `manifest.json` land on disk
  under `media/<id>/` and the 201 response carries a well-formed `manifest`; a non-image (a tiny PDF
  byte string) → 201 with **no** `manifest`.
- **image packages** — their existing contract/targeted tests stay green after swapping to
  `contentTypeFor`.
- Full repo green + typecheck, incl. the `@setu/core` edge guard over `src/image` (ingest is edge-safe).

## Out of scope (later media slices — roadmap)

The srcset/`<img>` responsive **render** that consumes the manifest (#4c); AVIF/multi-format/`<picture>`
(we chose single-format); per-image format/quality override (#4e); queued/batch generation for bulk
imports (#4f); focal point/crop (#4d); the media-library registry/UI (#6); full `setu.config`/theme
declared-sizes wiring (the config is injectable; this slice ships sensible defaults + a `SETU_IMAGE_FORMAT`
env override).

## Success criteria

Uploading a JPEG/PNG/WebP/AVIF through `POST /media` persists a responsive single-format width ladder
(`media/<id>/w<width>.<ext>`, capped at the source width, deduped) plus a `media/<id>/manifest.json`,
and returns the manifest in the response; a GIF or non-image stores the original only (no manifest); a
corrupt image keeps its original and returns without a manifest (upload never fails for generation);
the `ImageFormat→ext/contentType` maps are centralized in `@setu/core` and consumed by the image
packages; `ingestImage` is edge-safe and unit-tested with fakes (no sharp in core). All tests green.
