# Image format + LQIP — design

Date: 2026-06-30
Status: Approved (brainstorm), ready for plan
Owner: Mayank

## Problem / goal

Setu's responsive image pipeline (`@setu/image-astro` + `@setu/core` `ingestImage` + the
`apps/api` upload handler) generates WebP variants and emits `<img srcset>`. Two quality
upgrades the owner wants:

1. **Image format choice** — let a site choose WebP, AVIF, or **both** (an AVIF/WebP
   `<picture>` so every browser gets its best format). Today the format is a build-time env
   default (`SETU_IMAGE_FORMAT`); it should be a Git-backed **site setting**.
2. **LQIP "blur-up" (the Medium effect)** — an optional low-quality placeholder that shows a
   blurred preview of the image while the full image loads, then fades in. A site **setting**;
   when on, it applies to **every** image (hero, image block, inline) automatically.

## Decisions (from brainstorm)

- **Format = a setting with three choices: `webp` | `avif` | `both`** (default `webp`).
  `both` generates both formats and the renderer emits `<picture>`. Chosen over a forced
  auto-`<picture>` because AVIF encoding is slow and storage-heavy; the site picks its
  cost/quality trade-off, and `both` is available as a superset.
- **LQIP = a tiny inline base64 blurred image** (the real Medium look), stored once in the
  manifest. Chosen over BlurHash (needs per-image client JS to decode) and dominant-color
  (a flat color, not a preview of the photo).
- **Existing images = new-uploads + a "Reprocess all images" action** that regenerates every
  image's variants with current settings, shipped with a clear **warning to run it locally**
  (re-encoding the whole library — especially AVIF — is heavy and must not fire on a deployed
  instance). Auto-reprocess-on-setting-change was rejected as too risky/cost-unfriendly.

## Architecture — the spine

**settings → pipeline → manifest → renderer.** Settings drive only the *pipeline* (what to
generate at upload/reprocess). The result is recorded in the *manifest*. The *renderer* reads
the manifest and is **setting-agnostic** — it emits `<picture>` iff multiple formats are
present and a blur-up iff an `lqip` field is present. This keeps the renderer dumb and the
whole feature decoupled.

### 1. Settings (`@setu/core` settings schema)

Add a **Media** group to the grouped `SiteSettings` schema
(`packages/core/src/settings/schema.ts` + `types.ts`):

- `imageFormat: 'webp' | 'avif' | 'both'` — default `'webp'`
- `imageLqip: boolean` — default `false`

Surfaced in the admin `/settings` UI as a **Media** section (a select + a switch), following the
existing settings-group pattern (see [[setu-settings]]). Secrets stay env; these are content
settings, so they live in `settings.json`.

### 2. Manifest contract (`@setu/core` `MediaManifest`)

Today: `{ variants: [{ key, width }], original: { width, height } }`.

Change:
- **Format-tagged variants**: each variant gains `format` → `{ key, width, format }`. Old
  manifests (no `format`) are read as `'webp'` (back-compatible).
- **LQIP**: add `lqip?: string` — a base64 `data:` URI of the blurred placeholder.

This is the load-bearing change; the pipeline writes it and the renderer reads it.

### 3. Pipeline (`ingestImage` in `@setu/core` + `apps/api/src/media.ts`)

`ingestImage({ mediaKey, bytes, originalKey, format, widths, lqip })`:
- **Format**: `webp`/`avif` → encode each width once in that format. `both` → encode each width
  in **both** formats; all variants go into `variants` tagged with their `format`.
- **LQIP**: when `lqip` is true, also produce a ~20px-wide downscaled, blurred version,
  encode it tiny (WebP, low quality), and store its base64 data-URI as `manifest.lqip`.

`media.ts` reads `imageFormat` + `imageLqip` from the Git-backed settings (replacing the
`SETU_IMAGE_FORMAT` env default) and passes them to `ingestImage`. The image-sharp adapter
(`createSharpImageAdapter`) already does resize + `toFormat`; it gains a small blur+downscale
path for the LQIP.

### 4. Renderer (`@setu/image-astro`)

`image-markup.ts` + `Image.astro` + `ImageFigure.astro` read the manifest only:
- **One format** → today's `<img srcset sizes width height loading decoding>`.
- **Multiple formats** → `<picture>` with `<source type="image/avif" srcset=…>` +
  `<source type="image/webp" srcset=…>` + the `<img>` fallback, each `srcset` built from the
  variants of that format.
- **`lqip` present** → wrap in a blur-up: the data-URI as a blurred backdrop sized by the known
  `width`/`height` (so **no layout shift**); the real image starts transparent and fades in on
  load via **one small shared inline script** (gated; with JS off, the loaded image simply
  covers the blurred preview — graceful). Because hero, image block, and inline images all
  route through this renderer, the effect applies everywhere with no per-block work.

### 5. Reprocess action (`apps/api` + admin Settings → Media)

A **"Reprocess all images"** button in the Media settings section: iterates every stored
manifest, re-runs `ingestImage` with current settings, writes the new variants/manifest, and
commits. Shows a **warning** that it re-encodes the whole library and is best run **locally**
(not on a deployed instance). Reports progress/counts; safe to re-run (idempotent for unchanged
settings).

## Components & boundaries

- `packages/core/src/settings/{schema,types}.ts` — Media settings group.
- `packages/core/src/...` — `MediaManifest` type (format-tagged variants + `lqip`); `ingestImage`
  (format/both + LQIP generation).
- `packages/image-sharp/src/index.ts` — blur+downscale path for the LQIP placeholder.
- `apps/api/src/media.ts` — read settings → pass to `ingestImage`; the reprocess endpoint.
- `packages/image-astro/src/lib/image-markup.ts` + `Image.astro` + `ImageFigure.astro` —
  `<picture>` + blur-up markup; the shared fade script.
- `apps/admin` — Settings → Media UI (select + switch) + the Reprocess button + warning.

## Testing

- **Pipeline unit tests**: `format: 'both'` yields variants in both formats (tagged); `lqip`
  yields a `data:` URI in the manifest; `webp`/`avif` single-format unchanged; manifest
  back-compat (old manifest without `format` reads as webp).
- **Renderer tests**: multi-format manifest → `<picture>` with avif+webp sources; single →
  `<img srcset>`; `lqip` present → blur-up wrapper with intrinsic dims (no-CLS) + placeholder.
- **Settings round-trip test**: the Media group serializes/parses in `settings.json`.
- **Render-smoke** (today's lesson): the image block + an LQIP image SSR through the real
  markdoc+theme pipeline without error.
- **Live UAT gate (DoD #1)**: upload an image under each format setting and with LQIP on/off;
  confirm `<picture>`/format and the blur-up fade in the running app; run Reprocess locally and
  confirm existing images pick up the new treatment.

## Scope

**In:** the Media settings (format + LQIP), the pipeline + manifest changes, the renderer
(`<picture>` + blur-up), the Reprocess action with the local-run warning.

**Out (YAGNI):** per-image format/LQIP overrides; on-render/lazy variant generation; AVIF for
the LQIP placeholder (WebP tiny is fine); a progress UI beyond a simple count/warning.

## Risks

- **AVIF encode cost** — slow; mitigated by it being opt-in (`avif`/`both`) and the Reprocess
  local-run warning. Stay within the Cloudflare-Pages-friendly / cost-safe constraint
  ([[setu-engineering-constraints]]).
- **Manifest migration** — the `format` tag must default to `webp` for old manifests so existing
  sites keep rendering; covered by a back-compat test.
- **Blur-up + LCP** — the fade script must not delay the largest contentful paint; keep it tiny
  and non-blocking (the `<img>` still loads eagerly where appropriate).
