# Generate-on-upload + Persist Variants + Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an image is uploaded, generate a responsive single-format width ladder via the ImagePort, persist each variant + a manifest to StoragePort, and return the manifest.

**Architecture:** An edge-safe `ingestImage` orchestration service in `@setu/core` (over the injected `ImagePort` + `StoragePort`), centralized `format→ext/contentType` helpers, and the upload handler in `@setu/api` calling `ingestImage` for generatable images with a real sharp adapter wired in.

**Tech Stack:** TypeScript, `@setu/core` (ports + ingest), `@setu/image-sharp` (sharp adapter), `@setu/storage-local`, Hono, Vitest.

## Global Constraints

- **ONE format per the config, never both.** `imageFormat: 'webp' | 'avif'` (default `'webp'`). The original is always kept (canonical bytes + fallback). No `<picture>`/multi-format.
- **`ingestImage` is edge-safe** — pure orchestration over `ImagePort` + `StoragePort` interfaces; no Node/DOM (`TextEncoder`/`JSON`/`Set` are universal). It lives in `@setu/core/src/image/` (already under the edge guard `tsconfig.edge.json`). NO sharp in `@setu/core`.
- **Effective widths** = configured widths `< sourceWidth`, plus the source width itself — deduped, ascending. **Never upscale.** Variant key = `media/<id>/w<width>.<ext>`; manifest at `media/<id>/manifest.json`.
- **Generatable types** = `image/jpeg`, `image/png`, `image/webp`, `image/avif`. **gif is excluded** (animated — original only). Non-image → original only.
- **On generation failure: keep the original, return it WITHOUT a manifest** (never fail the upload); `console.warn`. **No image port injected → generation skipped** (storage-only mode).
- **Centralize** `extensionFor(format)` (`jpeg→jpg`) + `contentTypeFor(format)` (`image/<format>`) in `@setu/core`; refactor `@setu/image-sharp` and `@setu/image-testing` to consume `contentTypeFor` (delete their local `CONTENT_TYPE` maps). The content-type→ext **allowlist** `EXT_BY_TYPE` in `media.ts` is a *different* map (content-type keyed, includes non-images) — leave it.
- **Default widths** `[400, 800, 1200, 1600]`. `server.ts` reads `SETU_IMAGE_FORMAT` (`webp`|`avif`, default `webp`).
- **Patterns to mirror:** core tests in `packages/core/test/` (Vitest, in-memory fakes — NO sharp in core tests); api e2e in `apps/api/test/media-e2e.test.ts` (`createLocalStorage` on a tmp dir + `app.fetch(new Request(...))`); image packages = `@setu/image-sharp`/`@setu/image-testing`.

---

### Task 1: `@setu/core` — format helpers + `MediaManifest` + `ingestImage`

**Files:**
- Create: `packages/core/src/image/format.ts`
- Create: `packages/core/src/image/manifest.ts`
- Create: `packages/core/src/image/ingest.ts`
- Modify: `packages/core/src/index.ts` (export the new symbols)
- Test: `packages/core/test/image-ingest.test.ts`

**Interfaces:**
- Consumes: `ImagePort`, `ImageFormat`, `VariantSpec`, `GeneratedVariant` (`./image/image-port`); `StoragePort`, `StoredObject` (`../storage/storage-port`).
- Produces:
  - `extensionFor(format: ImageFormat): string`; `contentTypeFor(format: ImageFormat): string`
  - `interface ManifestVariant { width: number; height: number; key: string; contentType: string }`
  - `interface MediaManifest { id: string; format: ImageFormat; original: { key: string; width: number; height: number; format: string }; variants: ManifestVariant[] }`
  - `interface IngestDeps { image: ImagePort; storage: StoragePort }`
  - `interface IngestInput { id: string; bytes: Uint8Array; originalKey: string; format: ImageFormat; widths: number[] }`
  - `ingestImage(deps: IngestDeps, input: IngestInput): Promise<MediaManifest>`

- [ ] **Step 1: Write the failing test**

`packages/core/test/image-ingest.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { GeneratedVariant, ImagePort, StoragePort, StoredObject, VariantSpec } from '../src/index'
import { ingestImage, extensionFor, contentTypeFor } from '../src/index'

function memStorage() {
  const map = new Map<string, StoredObject>()
  const port: StoragePort = {
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `/uploads/${key}` },
  }
  return { port, map }
}

/** Stub ImagePort: source is srcW×srcH; generate echoes each spec's width (height by aspect). */
function stubImage(srcW: number, srcH: number): ImagePort {
  return {
    async metadata() { return { width: srcW, height: srcH, format: 'png' } },
    async generate(_src, specs: VariantSpec[]): Promise<GeneratedVariant[]> {
      return specs.map((s) => ({
        name: s.name,
        width: s.width,
        height: Math.round((srcH * s.width) / srcW),
        format: s.format,
        contentType: `image/${s.format}`,
        body: new Uint8Array([s.width & 255]),
      }))
    },
  }
}

describe('format helpers', () => {
  it('extensionFor maps jpeg to jpg, others identity', () => {
    expect(extensionFor('jpeg')).toBe('jpg')
    expect(extensionFor('webp')).toBe('webp')
    expect(extensionFor('avif')).toBe('avif')
    expect(extensionFor('png')).toBe('png')
  })
  it('contentTypeFor builds image/<format>', () => {
    expect(contentTypeFor('jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('webp')).toBe('image/webp')
  })
})

describe('ingestImage', () => {
  it('persists a deduped, no-upscale ladder + manifest and returns it', async () => {
    const { port, map } = memStorage()
    const manifest = await ingestImage(
      { image: stubImage(1000, 500), storage: port },
      { id: 'abc', bytes: new Uint8Array([1]), originalKey: 'media/abc/original.png', format: 'webp', widths: [400, 800, 1200, 1600] },
    )
    // 1200 & 1600 exceed the 1000px source → dropped; source width 1000 added ⇒ [400, 800, 1000]
    expect(manifest.variants.map((v) => v.width)).toEqual([400, 800, 1000])
    expect(manifest.variants.map((v) => v.key)).toEqual([
      'media/abc/w400.webp',
      'media/abc/w800.webp',
      'media/abc/w1000.webp',
    ])
    expect(manifest.original).toEqual({ key: 'media/abc/original.png', width: 1000, height: 500, format: 'png' })
    expect(manifest.format).toBe('webp')
    expect(map.get('media/abc/w400.webp')?.contentType).toBe('image/webp')
    const mf = map.get('media/abc/manifest.json')
    expect(mf?.contentType).toBe('application/json')
    expect(JSON.parse(new TextDecoder().decode(mf!.body)).id).toBe('abc')
  })

  it('uses the .jpg extension for the jpeg format and never upscales', async () => {
    const { port } = memStorage()
    const manifest = await ingestImage(
      { image: stubImage(500, 500), storage: port },
      { id: 'x', bytes: new Uint8Array([1]), originalKey: 'media/x/original.jpg', format: 'jpeg', widths: [400, 800] },
    )
    // 800 > 500 source → dropped; 400 kept + source 500 ⇒ [400, 500]
    expect(manifest.variants.map((v) => v.key)).toEqual(['media/x/w400.jpg', 'media/x/w500.jpg'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/core test image-ingest`
Expected: FAIL — `ingestImage`/`extensionFor`/`contentTypeFor` are not exported yet.

- [ ] **Step 3: Write the format helpers**

`packages/core/src/image/format.ts`:
```ts
import type { ImageFormat } from './image-port'

/** File extension for an output format (jpeg → jpg; others identity). */
export function extensionFor(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

/** MIME content-type for an output format. */
export function contentTypeFor(format: ImageFormat): string {
  return `image/${format}`
}
```

- [ ] **Step 4: Write the manifest type**

`packages/core/src/image/manifest.ts`:
```ts
import type { ImageFormat } from './image-port'

export interface ManifestVariant {
  width: number
  height: number
  key: string
  contentType: string
}

/** Describes a stored image: its original + the generated single-format variant ladder. */
export interface MediaManifest {
  id: string
  format: ImageFormat
  original: { key: string; width: number; height: number; format: string }
  variants: ManifestVariant[]
}
```

- [ ] **Step 5: Write the ingest service**

`packages/core/src/image/ingest.ts`:
```ts
import type { ImageFormat, ImagePort } from './image-port'
import type { StoragePort } from '../storage/storage-port'
import type { ManifestVariant, MediaManifest } from './manifest'
import { contentTypeFor, extensionFor } from './format'

export interface IngestDeps {
  image: ImagePort
  storage: StoragePort
}
export interface IngestInput {
  id: string
  bytes: Uint8Array
  /** Key of the already-stored original (e.g. media/<id>/original.png). */
  originalKey: string
  format: ImageFormat
  widths: number[]
}

/** Generate a responsive single-format width ladder for an already-stored original,
 *  persist each variant + a manifest to storage, and return the manifest. Edge-safe —
 *  pure orchestration over the injected ImagePort + StoragePort. */
export async function ingestImage(deps: IngestDeps, input: IngestInput): Promise<MediaManifest> {
  const { image, storage } = deps
  const { id, bytes, originalKey, format, widths } = input

  const meta = await image.metadata(bytes)
  const ext = extensionFor(format)
  const contentType = contentTypeFor(format)

  // Effective widths: configured widths below the source, plus the source width (cap).
  // Never upscale; dedupe; ascending — so each spec width equals its actual output width.
  const effective = [...new Set([...widths.filter((w) => w < meta.width), meta.width])].sort((a, b) => a - b)
  const specs = effective.map((w) => ({ name: `w${w}`, width: w, format }))
  const variants = await image.generate(bytes, specs)

  const manifestVariants: ManifestVariant[] = []
  for (const v of variants) {
    const key = `media/${id}/w${v.width}.${ext}`
    await storage.put(key, v.body, { contentType })
    manifestVariants.push({ width: v.width, height: v.height, key, contentType })
  }

  const manifest: MediaManifest = {
    id,
    format,
    original: { key: originalKey, width: meta.width, height: meta.height, format: meta.format },
    variants: manifestVariants,
  }
  await storage.put(`media/${id}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)), {
    contentType: 'application/json',
  })
  return manifest
}
```

- [ ] **Step 6: Export from the core barrel**

In `packages/core/src/index.ts`, add (near the other `image` exports):
```ts
export { extensionFor, contentTypeFor } from './image/format'
export type { ManifestVariant, MediaManifest } from './image/manifest'
export { ingestImage } from './image/ingest'
export type { IngestDeps, IngestInput } from './image/ingest'
```

- [ ] **Step 7: Run the test + typecheck (incl. edge guard)**

Run: `pnpm --filter @setu/core test image-ingest && pnpm --filter @setu/core typecheck`
Expected: PASS (5 tests) + typecheck clean — `tsc -p tsconfig.edge.json` confirms `ingestImage` is edge-safe (no Node imports).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/image/ packages/core/src/index.ts packages/core/test/image-ingest.test.ts
git commit -m "feat(core): ingestImage service + format helpers + MediaManifest (edge-safe)"
```

---

### Task 2: Centralize the content-type map in the image packages

**Files:**
- Modify: `packages/image-sharp/src/index.ts`
- Modify: `packages/image-testing/src/index.ts`

**Interfaces:**
- Consumes: `contentTypeFor` from `@setu/core` (Task 1).

- [ ] **Step 1: Refactor `@setu/image-sharp`**

In `packages/image-sharp/src/index.ts`:
- Delete the local `const CONTENT_TYPE: Record<ImageFormat, string> = { … }` block.
- Add `contentTypeFor` to the `@setu/core` import (it currently imports types only — change to also import the value):
```ts
import { contentTypeFor } from '@setu/core'
import type { GeneratedVariant, ImageFormat, ImageMeta, ImagePort, VariantSpec } from '@setu/core'
```
- Replace `contentType: CONTENT_TYPE[spec.format]` with `contentType: contentTypeFor(spec.format)`.

- [ ] **Step 2: Refactor `@setu/image-testing`**

In `packages/image-testing/src/index.ts`:
- Delete the local `const CONTENT_TYPE: Record<ImageFormat, string> = { … }` block.
- Import `contentTypeFor` from `@setu/core`:
```ts
import { contentTypeFor } from '@setu/core'
```
- Replace `expect(v.contentType).toBe(CONTENT_TYPE[v.format]!)` with `expect(v.contentType).toBe(contentTypeFor(v.format))`.

- [ ] **Step 3: Run both packages' tests + typecheck (no behaviour change)**

Run: `pnpm --filter @setu/image-sharp test && pnpm --filter @setu/image-testing test && pnpm --filter @setu/image-sharp typecheck && pnpm --filter @setu/image-testing typecheck`
Expected: PASS — image-sharp 9 tests, image-testing 3 tests, all green (the swap is behaviour-preserving); typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/image-sharp/src/index.ts packages/image-testing/src/index.ts
git commit -m "refactor(image): consume @setu/core contentTypeFor (drop duplicated maps)"
```

---

### Task 3: Wire generation into the upload handler

**Files:**
- Modify: `apps/api/package.json` (add image deps)
- Modify: `apps/api/src/media.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/media-ingest-e2e.test.ts`

**Interfaces:**
- Consumes: `ingestImage`, `ImagePort`, `ImageFormat`, `MediaManifest` from `@setu/core` (Task 1); `createSharpImageAdapter` from `@setu/image-sharp`; `makeTestPng` from `@setu/image-testing` (test only).
- Produces: `createUploadApi({ storage, resolveActor, limits?, image?, imageConfig? })` — when `image` is present and the upload is a generatable image, the 201 response includes a `manifest`.

- [ ] **Step 1: Add the dependencies**

Edit `apps/api/package.json`:
- In `"dependencies"`, add (alphabetical with the other `@setu/*`):
```json
    "@setu/image-sharp": "workspace:*",
```
- In `"devDependencies"`, add:
```json
    "@setu/image-testing": "workspace:*",
```
Then run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing e2e test**

`apps/api/test/media-ingest-e2e.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { makeTestPng } from '@setu/image-testing'
import { createUploadApi } from '../src/media'

const dirs: string[] = []
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0 })

function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-'))
  dirs.push(dir)
  const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/uploads' })
  const app = createUploadApi({
    storage,
    resolveActor: () => ({ id: 'local', role: 'owner' }),
    image: createSharpImageAdapter(),
    imageConfig: { format: 'webp', widths: [400, 800, 1200, 1600] },
  })
  return { app, dir }
}

interface Resp { id: string; manifest?: { variants: { width: number; key: string }[] } }

describe('media ingest e2e (real sharp + storage-local)', () => {
  it('generates a webp ladder + manifest for an uploaded PNG', async () => {
    const { app, dir } = freshApp()
    const body = new FormData()
    body.append('file', new File([makeTestPng(1000, 600)], 'pic.png', { type: 'image/png' }))
    const res = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(res.status).toBe(201)
    const json = (await res.json()) as Resp
    expect(json.manifest).toBeTruthy()
    // 1200 & 1600 exceed the 1000px source → dropped; source 1000 added ⇒ [400, 800, 1000]
    expect(json.manifest!.variants.map((v) => v.width)).toEqual([400, 800, 1000])
    expect(existsSync(join(dir, `media/${json.id}/w400.webp`))).toBe(true)
    expect(existsSync(join(dir, `media/${json.id}/manifest.json`))).toBe(true)
  })

  it('stores a non-image without a manifest', async () => {
    const { app } = freshApp()
    const body = new FormData()
    body.append('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', { type: 'application/pdf' }))
    const res = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(res.status).toBe(201)
    expect((await res.json() as Resp).manifest).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @setu/api test media-ingest-e2e`
Expected: FAIL — `createUploadApi` doesn't accept `image`/`imageConfig` yet, so no `manifest` is returned (the first test's `expect(json.manifest).toBeTruthy()` fails).

- [ ] **Step 4: Add generation to the upload handler**

In `apps/api/src/media.ts`:
- Extend the imports:
```ts
import { createAuthz, DEFAULT_ROLES, ingestImage } from '@setu/core'
import type { Actor, ImageFormat, ImagePort, MediaManifest, StoragePort } from '@setu/core'
```
- Add the generatable-types set near `DEFAULT_ALLOWED`:
```ts
/** Raster image types we generate variants for (gif excluded — animated). */
const GENERATABLE: Set<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export interface ImageConfig { format: ImageFormat; widths: number[] }
const DEFAULT_IMAGE_CONFIG: ImageConfig = { format: 'webp', widths: [400, 800, 1200, 1600] }
```
- Extend `UploadApiOptions`:
```ts
export interface UploadApiOptions {
  storage: StoragePort
  resolveActor: ResolveActor
  limits?: Partial<UploadLimits>
  image?: ImagePort
  imageConfig?: ImageConfig
}
```
- Inside `createUploadApi`, after `const { storage } = opts`, add:
```ts
  const imageConfig = opts.imageConfig ?? DEFAULT_IMAGE_CONFIG
```
- In the `POST /media` handler, replace the final `storage.put` + `return c.json(...)` block (the bytes are already stored) with:
```ts
    const bytes = new Uint8Array(await file.arrayBuffer())
    await storage.put(key, bytes, { contentType: file.type })

    let manifest: MediaManifest | undefined
    if (opts.image && GENERATABLE.has(file.type)) {
      try {
        manifest = await ingestImage(
          { image: opts.image, storage },
          { id, bytes, originalKey: key, format: imageConfig.format, widths: imageConfig.widths },
        )
      } catch (err) {
        console.warn(`media ingest failed for ${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return c.json(
      {
        id,
        key,
        url: storage.url(key),
        contentType: file.type,
        size: file.size,
        filename: file.name,
        ...(manifest ? { manifest } : {}),
      },
      201,
    )
```

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `pnpm --filter @setu/api test media-ingest-e2e`
Expected: PASS (2 tests). Also confirm no regression in the existing media tests: `pnpm --filter @setu/api test media`
Expected: all green (the existing `media-e2e`/`media-upload` tests pass no `image`, so generation is skipped — unchanged behaviour).

- [ ] **Step 6: Wire the sharp adapter into the server**

Replace `apps/api/src/server.ts` with:
```ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createSharpImageAdapter } from '@setu/image-sharp'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'
import { createUploadApi } from './media'
import { resolveLocalOwner } from './auth/resolve-actor'

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const mediaDir = process.env.SETU_MEDIA_DIR ?? `${dir}/.setu/uploads`
const mediaPublicUrl = process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/uploads`
const imageFormat = process.env.SETU_IMAGE_FORMAT === 'avif' ? 'avif' : 'webp'

const app = new Hono()
app.route('/', createGitApi(createLocalGitAdapter({ dir })))
app.route('/', createPreviewApi())
app.route('/', createUploadApi({
  storage: createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl }),
  resolveActor: resolveLocalOwner,
  image: createSharpImageAdapter(),
  imageConfig: { format: imageFormat, widths: [400, 800, 1200, 1600] },
}))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir}, image: ${imageFormat})`)
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @setu/api typecheck`
Expected: PASS — `imageFormat` is `'avif' | 'webp'` (narrowed by the ternary), assignable to `ImageConfig['format']`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/src/media.ts apps/api/src/server.ts apps/api/test/media-ingest-e2e.test.ts pnpm-lock.yaml
git commit -m "feat(api): generate + persist variant ladder + manifest on image upload"
```

---

## Final verification (after all tasks)

- [ ] Full suite + typecheck across the workspace:
  - `pnpm -r test`
  - `pnpm -r typecheck`
  - Expected: all green — core (incl. edge guard over `src/image` for `ingestImage`), image packages (refactored), api (ingest e2e + existing media tests).
- [ ] Manual smoke (optional): `pnpm dev`, upload an image via the admin `/media` page; check `.setu/uploads/media/<id>/` contains `original.*`, `w400.webp`…, and `manifest.json`.

## Notes for the executor

- **`@setu/core` stays sharp-free** — `ingestImage` orchestrates the injected ports only. The real sharp adapter is injected at the api edge (`server.ts`) and in the api e2e test. Core tests use the inline stub `ImagePort` + in-memory `StoragePort` fake. If a core task seems to need sharp, stop — the edge guard rejects it.
- **`image?` is optional and backward-compatible** — the existing `media-e2e`/`media-upload` tests don't pass it, so generation is skipped and they stay unchanged. Don't modify them.
- **Don't touch `EXT_BY_TYPE`** in `media.ts` (the allowlist) — it's a different, content-type-keyed map. The centralization is only about the `ImageFormat→contentType` map in the two image packages.
- **Node/jsdom globals** (`File`, `FormData`, `TextEncoder`, `TextDecoder`, `Uint8Array`) are global — no imports.
