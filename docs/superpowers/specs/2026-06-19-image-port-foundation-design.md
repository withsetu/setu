# ImagePort foundation — media slice #4a

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** Media/Images **#4a** — the first slice of #4 (`ImagePort` + optimization). The
**transform-engine foundation**: a dumb image port + contract battery + a sharp-on-Node adapter, with
NO wiring/persistence/render yet. Mirrors the `StoragePort` increment (#1) exactly: **Port (in
`@setu/core`) + contract suite + a real adapter.**

## Goal

An **`ImagePort`** — a *dumb image transform engine*: given source image bytes and a list of variant
specs (name + width + format + optional quality), produce the resized/re-encoded bytes for each — plus
a behavioural **contract battery** every adapter runs, plus the first real adapter **`@setu/image-sharp`**
(sharp on Node). The port knows nothing about *which* sizes to make, focal points, storage keys, or
srcset — **variants are just bytes the caller (#4b) persists to the `StoragePort`**. Pure infrastructure
with no consumer yet, exactly like the `StoragePort` increment.

**Explicitly NOT in this slice** (later #4 sub-slices + the roadmap): generate-on-upload wiring +
variant persistence + the manifest (#4b); `srcset`/`<picture>` responsive render (#4c); focal
point/crop (#4d); per-image quality/format override UI (#4e); queued/batch generation (#4f); the
Cloudflare-Images edge adapter (when the API goes to edge); theme-declared sizes config (lands in #4b).

## Verified before designing (standing rules)

- **Rule #1 (read source / check docs):**
  - Mirrors the established `StoragePort` pattern directly — `@setu/storage-testing` exposes
    `runStoragePortContract(makeAdapter)` (vitest a peerDependency); `@setu/core` holds the port
    interface (`src/storage/storage-port.ts`, covered by the edge guard `tsconfig.edge.json`);
    `@setu/storage-local` is a Node adapter that runs the contract. This slice copies that structure
    for images.
  - **sharp verified (web, 2026-06-19):** latest **0.35.1**, **Apache-2.0**, **prebuilt binaries** for
    macOS/Windows/Linux (no system libvips/extra runtime deps on modern systems), requires **Node ≥
    20.9** (we run Node 22). First-class **AVIF/WebP/JPEG/PNG** encoding. ([npm](https://www.npmjs.com/package/sharp),
    [releases](https://github.com/lovell/sharp/releases), [docs](https://sharp.pixelplumbing.com/)).
- **Rule #2 (Cloudflare + cost):**
  - The `ImagePort` **interface + types live in `@setu/core`** and stay **edge/browser-safe** (no Node
    APIs — covered by the edge guard `tsconfig.edge.json`). The Node-only sharp adapter lives in its own
    package (`@setu/image-sharp`), exactly as `storage-local` keeps `node:fs` out of core.
  - **sharp is Node-only by design** (it can't run on Cloudflare Workers — a verified hard wall). The
    port abstracts the engine so the **CF-Images edge adapter** drops in behind the *same* interface
    later (when the API moves to a Worker). This slice ships only the sharp adapter.
  - **No per-visitor runtime cost:** the port is a build/admin-side transform engine. The store-once
    model (generate variants once → persist → serve static) means zero per-render transform cost; this
    slice is just the engine, the persistence is #4b.

## Architecture — three units

### 1. `ImagePort` interface (`@setu/core/src/image/`)
Pure types, edge-safe. A dumb image transform engine:

```ts
// @setu/core/src/image/image-port.ts
export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png'

/** One requested output: a named variant at a target width + format (+ optional quality 1–100). */
export interface VariantSpec { name: string; width: number; format: ImageFormat; quality?: number }

/** Intrinsic properties of a source image. */
export interface ImageMeta { width: number; height: number; format: string }

/** A produced variant — bytes + the actual dimensions/format/content-type. */
export interface GeneratedVariant {
  name: string
  width: number
  height: number
  format: ImageFormat
  contentType: string
  body: Uint8Array
}

export interface ImagePort {
  /** Intrinsic width/height/format of the source bytes. */
  metadata(source: Uint8Array): Promise<ImageMeta>
  /** Produce one output per spec, in order. Never upscales; preserves aspect ratio. */
  generate(source: Uint8Array, specs: VariantSpec[]): Promise<GeneratedVariant[]>
}
```

- `body` is `Uint8Array` (universal). `source` is the original upload bytes; the caller (#4b) decides
  the spec matrix and persists each `GeneratedVariant.body` as a `StoragePort` key.
- **Contract behaviour (baked in, adapter-enforced):**
  - **Never upscale** — output `width = min(spec.width, sourceWidth)`. A spec wider than the source
    yields a variant at the source width (not enlarged), so output is never blurry/wasteful.
  - **Aspect ratio preserved** — height is derived from width; no cropping (crop/focal is #4d).
  - **Format + quality** — re-encode to `spec.format`; `spec.quality` (1–100) when given, else a sane
    per-format default. `contentType` matches the format (`image/webp`, `image/avif`, `image/jpeg`,
    `image/png`).
  - **One output per spec, order preserved**, `name` echoed.

### 2. `@setu/image-testing` — the contract battery
Mirrors `@setu/storage-testing`. Exports `runImagePortContract(makeAdapter: () => Promise<ImagePort> |
ImagePort)` — a Vitest battery any adapter runs. `vitest` is a **peerDependency**. Ships a couple of
tiny **embedded real image fixtures** (e.g. a base64-decoded PNG of a known size like 200×120) so the
battery is **self-contained** — it does NOT depend on sharp to *create* fixtures. It verifies produced
variants by feeding them back through the **adapter's own `metadata()`** (dogfooding).

The battery asserts: `generate` returns one variant per spec (names + order preserved); each variant's
`contentType` matches its `format`; `metadata(variant.body)` reports `width = min(spec.width,
sourceWidth)` and the requested `format`; **no upscaling** (a spec wider than the source → output at the
source width); **aspect ratio preserved** (output height ≈ sourceHeight × outputWidth / sourceWidth,
within a rounding tolerance); `metadata(source)` returns the fixture's known intrinsic
width/height/format. `makeAdapter` returns a ready adapter each call.

### 3. `@setu/image-sharp` — the sharp-on-Node adapter
`createSharpImageAdapter(): ImagePort`:
- `metadata(source)` → `sharp(buf).metadata()` mapped to `{ width, height, format }`.
- `generate(source, specs)` → for each spec: `sharp(buf).resize(spec.width, null, { withoutEnlargement:
  true }).toFormat(spec.format, { quality: spec.quality ?? DEFAULT[spec.format] }).toBuffer({
  resolveWithObject: true })`; read the actual `info.width`/`info.height` for the returned variant.
- **Defaults:** AVIF ≈ 55, WebP ≈ 75, JPEG ≈ 80, PNG lossless (no quality). (Conservative, good
  size/quality; per-image overrides are #4e.)
- `sharp` is a **runtime dependency of this package only** (never of `@setu/core`).

## Data flow

```
caller (#4b, later)  ──generate(sourceBytes, [{name,width,format,quality?}, …])──▶  ImagePort
                                                                                     └─ image-sharp → sharp resize+encode → GeneratedVariant[] (bytes + dims)
caller then persists each variant.body to StoragePort (media/<id>/<name>.<ext>) + records a manifest   ← all #4b
```

## Error handling

- `generate`/`metadata` on bytes that aren't a decodable image → the adapter throws (fail loud — the
  upload layer #4b decides how to surface it; the upload service already validates content-type, so
  this is a defensive guard).
- An empty `specs` array → `generate` returns `[]` (no error).
- A `spec.width <= 0` or an unsupported `format` (outside the `ImageFormat` union) → the adapter throws
  a clear error (the type system prevents the format case at compile time; the runtime guard covers
  bad widths).

## Testing

- **`@setu/image-testing`:** `runImagePortContract` self-tested against the **sharp adapter** (a
  transform engine has no trivial reference — see the deviation note), proving the battery + sharp
  together. Embedded PNG fixtures of known sizes.
- **`@setu/image-sharp`:** runs `runImagePortContract(() => createSharpImageAdapter())`; plus targeted
  tests — AVIF/WebP/JPEG/PNG each produce the right magic-bytes/content-type; a quality override yields
  a smaller body than a high quality; a downscale to a width yields the expected dims; an upscale
  request is clamped to the source width.
- **edge guard:** `@setu/core`'s `tsconfig.edge.json` includes `src/image` and compiles with no
  Node/DOM types (the interface is pure) — adversarial check: importing `sharp`/`node:*` into the port
  file fails the guard.
- Repo-wide tests + typecheck green.

## Deliberate deviation from the StoragePort pattern (recorded)

`StoragePort` shipped a trivial in-memory **reference** adapter (a `Map`) to self-test its battery. An
image transform engine **cannot be meaningfully faked** (it needs a real codec), so this slice ships
**no reference adapter** — the battery self-tests against the **real sharp adapter**, and a future
CF-Images adapter runs the same battery. This is the honest shape for a transform port.

## Out of scope (later media slices — roadmap)

Generate-on-upload + persistence + manifest (#4b); responsive `srcset`/`<picture>` render (#4c); focal
point/crop (#4d); per-image quality/format override UI (#4e); queued/batch generation (#4f); the
Cloudflare-Images edge adapter; theme-declared sizes config (#4b); the media registry/library (#6);
`@setu/storage-s3` (#7).

## Success criteria

`ImagePort` (a dumb image transform engine) is defined in `@setu/core` (edge-safe), `@setu/image-testing`
runs a behavioural battery any adapter passes, and `@setu/image-sharp` resizes + re-encodes real images
into named variants — never upscaling, preserving aspect, with correct formats/content-types — all
green, with the contract suite ready for the CF-Images adapter to drop into later. No wiring, no
persistence, no render — the clean engine foundation.
