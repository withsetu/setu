# Image format + LQIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site choose image format (WebP / AVIF / both → `<picture>`) and opt into LQIP "blur-up" placeholders, both as Git-backed settings applied across every image via the shared pipeline + renderer.

**Architecture:** settings → pipeline → manifest → renderer. Settings drive only the pipeline (what to generate at upload/reprocess); the manifest records the result (format-tagged variants + an optional `lqip` data-URI); the renderer reads the manifest and is setting-agnostic (emits `<picture>` iff >1 format present, a blur-up iff `lqip` present).

**Tech Stack:** TypeScript, Zod (settings), sharp/libvips (`@setu/image-sharp`), Astro (`@setu/image-astro`), Hono (`apps/api`), React 19 + shadcn (`apps/admin`), Vitest.

## Global Constraints

- Edge-safe core: `packages/core/src/image/*` and `settings/*` compile under the edge tsconfig (no DOM, no Node `Buffer`) — keep `ingestImage` pure orchestration; do all `Buffer`/base64 work in the Node sharp adapter.
- Back-compat: existing manifests have `format: ImageFormat` + variants WITHOUT a per-variant `format`. New readers MUST treat a variant's missing `format` as `manifest.format`. Don't break old manifests.
- Format setting values are exactly `'webp' | 'avif' | 'both'` (default `'webp'`); LQIP setting is a boolean (default `false`).
- `both` → generate both formats; the `<img>` fallback is **WebP** (widest support); AVIF `<source>` comes first in `<picture>`.
- LQIP placeholder is a **WebP** tiny (~20px) blurred image as a base64 `data:` URI; never stored as a file.
- Cost-safe: AVIF is opt-in; the Reprocess action must warn it's heavy and best run locally.
- Test: `pnpm --filter @setu/core test`, `pnpm --filter @setu/image-sharp test`, `pnpm --filter @setu/image-astro test`, `pnpm --filter @setu/api test`, `pnpm --filter @setu/admin test`. Typecheck: `pnpm -r typecheck`.
- Commit per task. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/core/src/image/manifest.ts` — `ManifestVariant.format?`, `MediaManifest.lqip?`.
- `packages/core/src/image/image-port.ts` — `ImagePort.placeholder()`.
- `packages/core/src/image/ingest.ts` — `IngestInput.formats` + `.lqip`; multi-format + LQIP generation.
- `packages/core/src/settings/{types,schema,defaults}.ts` — `media` settings group.
- `packages/image-sharp/src/index.ts` — `placeholder()` impl (blur+downscale+base64).
- `packages/image-testing/src/index.ts` — `placeholder()` for the fake adapter.
- `apps/api/src/media.ts` — read settings → formats+lqip; reprocess endpoint.
- `packages/image-astro/src/lib/image-markup.ts` — multi-format grouping + lqip in the markup model.
- `packages/image-astro/src/{Image.astro,ImageFigure.astro}` — `<picture>` + blur-up + fade script.
- `apps/admin` — Settings → Media section (format select + LQIP switch) + Reprocess button.

---

### Task 1: Manifest — per-variant format + lqip

**Files:**
- Modify: `packages/core/src/image/manifest.ts`
- Test: `packages/core/test/manifest-shape.test.ts` (create)

**Interfaces:**
- Produces: `ManifestVariant` gains `format?: ImageFormat`; `MediaManifest` gains `lqip?: string`. `MediaManifest.format` unchanged (the fallback format). A variant's effective format is `variant.format ?? manifest.format`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/manifest-shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { MediaManifest } from '../src/image/manifest'

describe('MediaManifest shape', () => {
  it('allows per-variant format and an optional lqip data-URI', () => {
    const m: MediaManifest = {
      id: '2026/06/cat', format: 'webp',
      original: { key: '2026/06/cat.png', width: 1600, height: 900, format: 'png' },
      variants: [
        { width: 800, height: 450, key: '2026/06/cat-w800.webp', contentType: 'image/webp', format: 'webp' },
        { width: 800, height: 450, key: '2026/06/cat-w800.avif', contentType: 'image/avif', format: 'avif' },
      ],
      lqip: 'data:image/webp;base64,AAAA',
    }
    expect(m.variants[1].format).toBe('avif')
    expect(m.lqip).toMatch(/^data:image\/webp;base64,/)
  })

  it('back-compat: a variant without format and no lqip is still valid', () => {
    const m: MediaManifest = {
      id: 'x', format: 'webp',
      original: { key: 'x.png', width: 10, height: 10, format: 'png' },
      variants: [{ width: 10, height: 10, key: 'x-w10.webp', contentType: 'image/webp' }],
    }
    expect(m.variants[0].format).toBeUndefined()
    expect(m.lqip).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test manifest-shape`
Expected: FAIL — `format`/`lqip` not assignable.

- [ ] **Step 3: Update the types**

In `packages/core/src/image/manifest.ts`, add `format?` to `ManifestVariant` and `lqip?` to `MediaManifest`:

```ts
export interface ManifestVariant {
  width: number
  height: number
  key: string
  contentType: string
  /** The variant's image format. Absent on legacy manifests → treat as the manifest's `format`. */
  format?: ImageFormat
}

/** Describes a stored image: its original + the generated variant ladder (one or more formats). */
export interface MediaManifest {
  id: string
  /** The primary/fallback format (the `<img>` src format when multiple are present). */
  format: ImageFormat
  original: { key: string; width: number; height: number; format: string }
  variants: ManifestVariant[]
  /** Optional LQIP blur-up placeholder: a tiny blurred WebP as a base64 data: URI. */
  lqip?: string
}
```

(`ImageFormat` is already imported in this file — confirm the existing import line; if `ImageFormat` isn't imported, add `import type { ImageFormat } from './image-port'`.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @setu/core test manifest-shape && pnpm --filter @setu/core typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/image/manifest.ts packages/core/test/manifest-shape.test.ts
git commit -m "feat(core): manifest per-variant format + optional lqip (back-compat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: ImagePort.placeholder + adapters

**Files:**
- Modify: `packages/core/src/image/image-port.ts`
- Modify: `packages/image-sharp/src/index.ts`
- Modify: `packages/image-testing/src/index.ts`
- Test: `packages/image-sharp/test/placeholder.test.ts` (create)

**Interfaces:**
- Produces: `ImagePort.placeholder(source: Uint8Array, width: number): Promise<string>` — returns a `data:image/webp;base64,…` URI of a downscaled, blurred WebP. Consumed by `ingestImage` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `packages/image-sharp/test/placeholder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { createSharpImageAdapter } from '../src/index'

async function pngBytes(w: number, h: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer()
  return new Uint8Array(buf)
}

describe('sharp placeholder (LQIP)', () => {
  it('returns a tiny blurred webp data-URI', async () => {
    const adapter = createSharpImageAdapter()
    const uri = await adapter.placeholder(await pngBytes(1600, 900), 20)
    expect(uri).toMatch(/^data:image\/webp;base64,/)
    // decode the base64 payload and confirm it is a small webp (width ~20)
    const b64 = uri.split(',')[1]
    const bytes = Buffer.from(b64, 'base64')
    const meta = await sharp(bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(20)
    expect(bytes.length).toBeLessThan(2000) // tiny
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/image-sharp test placeholder`
Expected: FAIL — `adapter.placeholder is not a function`.

- [ ] **Step 3: Add the method to the port interface**

In `packages/core/src/image/image-port.ts`, add to `interface ImagePort`:

```ts
  /** A tiny (≈`width`px), blurred WebP of the source as a base64 `data:` URI — the LQIP placeholder. */
  placeholder(source: Uint8Array, width: number): Promise<string>
```

- [ ] **Step 4: Implement in the sharp adapter**

In `packages/image-sharp/src/index.ts`, add a `placeholder` method to the returned object (alongside `metadata`/`generate`):

```ts
    async placeholder(source: Uint8Array, width: number): Promise<string> {
      const buf = await sharp(Buffer.from(source))
        .rotate()
        .resize(width, null, { withoutEnlargement: true })
        .blur(1.2)
        .webp({ quality: 40 })
        .toBuffer()
      return `data:image/webp;base64,${buf.toString('base64')}`
    },
```

- [ ] **Step 5: Implement in the test/fake adapter**

In `packages/image-testing/src/index.ts`, add a `placeholder` to its `ImagePort` implementation (deterministic, no real encoding):

```ts
    async placeholder(_source: Uint8Array, _width: number): Promise<string> {
      // Deterministic stub for tests — a 1px transparent webp data-URI.
      return 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA='
    },
```

(Read `packages/image-testing/src/index.ts` first to match its existing object shape/style; the method must be added to whatever object it returns as the `ImagePort`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @setu/image-sharp test placeholder && pnpm -r typecheck`
Expected: PASS. Typecheck clean (both adapters now satisfy `ImagePort`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/image/image-port.ts packages/image-sharp/src/index.ts packages/image-testing/src/index.ts packages/image-sharp/test/placeholder.test.ts
git commit -m "feat(image): ImagePort.placeholder — tiny blurred webp data-URI for LQIP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ingestImage — multi-format + LQIP

**Files:**
- Modify: `packages/core/src/image/ingest.ts`
- Modify: `packages/core/test/image-ingest.test.ts` (existing callers use `format:`)
- Test: add cases to `packages/core/test/image-ingest.test.ts`

**Interfaces:**
- Consumes: `ImagePort.placeholder` (Task 2); `ManifestVariant.format`/`MediaManifest.lqip` (Task 1).
- Produces: `IngestInput` changes `format: ImageFormat` → `formats: ImageFormat[]` and adds `lqip?: boolean`. `ingestImage` generates a width ladder for EACH format (variants tagged with `format`), sets `manifest.format = formats[0]`, and when `lqip` is true sets `manifest.lqip`.

- [ ] **Step 1: Update the existing test + add cases (write failing)**

In `packages/core/test/image-ingest.test.ts`: change every `format: 'webp'` in an `ingestImage(...)` input to `formats: ['webp']`. Then add:

```ts
  it('generates both formats (tagged) when formats=[webp,avif]', async () => {
    const { image, storage } = makeDeps() // existing helper in this file
    const m = await ingestImage({ image, storage }, {
      mediaKey: '2026/06/cat', bytes: srcBytes, originalKey: '2026/06/cat.png',
      formats: ['webp', 'avif'], widths: [400, 800],
    })
    expect(m.format).toBe('webp') // fallback
    const formats = new Set(m.variants.map((v) => v.format))
    expect(formats).toEqual(new Set(['webp', 'avif']))
    // same width appears once per format
    expect(m.variants.filter((v) => v.width === 400).length).toBe(2)
  })

  it('attaches an lqip data-URI when lqip=true', async () => {
    const { image, storage } = makeDeps()
    const m = await ingestImage({ image, storage }, {
      mediaKey: '2026/06/dog', bytes: srcBytes, originalKey: '2026/06/dog.png',
      formats: ['webp'], widths: [400], lqip: true,
    })
    expect(m.lqip).toMatch(/^data:image\/webp;base64,/)
  })
```

(Use the file's existing `makeDeps`/`srcBytes` helpers — read the test first to match names. The `image` must be the testing adapter from `@setu/image-testing`, which now has `placeholder`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test image-ingest`
Expected: FAIL — `formats` not accepted / multi-format + lqip not produced.

- [ ] **Step 3: Update ingestImage**

In `packages/core/src/image/ingest.ts`, change `IngestInput` and the body:

```ts
export interface IngestInput {
  mediaKey: string
  bytes: Uint8Array
  originalKey: string
  /** One or more formats to generate; the first is the manifest's fallback format. */
  formats: ImageFormat[]
  widths: number[]
  /** When true, also generate an LQIP blur-up placeholder. */
  lqip?: boolean
}

export async function ingestImage(deps: IngestDeps, input: IngestInput): Promise<MediaManifest> {
  const { image, storage } = deps
  const { mediaKey, bytes, originalKey, formats, widths, lqip } = input

  const meta = await image.metadata(bytes)
  const effective = [...new Set([...widths.filter((w) => w < meta.width), meta.width])].sort((a, b) => a - b)

  // One spec per (format × width).
  const specs = formats.flatMap((fmt) => effective.map((w) => ({ name: `w${w}-${fmt}`, width: w, format: fmt })))
  const generated = await image.generate(bytes, specs)

  const manifestVariants: ManifestVariant[] = []
  for (const v of generated) {
    const ext = extensionFor(v.format)
    const contentType = contentTypeFor(v.format)
    const key = variantKey(mediaKey, v.width, ext)
    await storage.put(key, v.body, { contentType })
    manifestVariants.push({ width: v.width, height: v.height, key, contentType, format: v.format })
  }

  const manifest: MediaManifest = {
    id: mediaKey,
    format: formats[0],
    original: { key: originalKey, width: meta.width, height: meta.height, format: meta.format },
    variants: manifestVariants,
    ...(lqip ? { lqip: await image.placeholder(bytes, 20) } : {}),
  }
  await storage.put(manifestKey(mediaKey), new TextEncoder().encode(JSON.stringify(manifest)), {
    contentType: 'application/json',
  })
  return manifest
}
```

Note: `variantKey(mediaKey, width, ext)` already keys by extension, so the same width in two formats yields two distinct keys (`…-w800.webp`, `…-w800.avif`) — no collision. `extensionFor`/`contentTypeFor` are already imported from `./format`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/core test image-ingest && pnpm --filter @setu/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/image/ingest.ts packages/core/test/image-ingest.test.ts
git commit -m "feat(core): ingestImage generates multi-format (tagged) variants + optional LQIP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Media settings group

**Files:**
- Modify: `packages/core/src/settings/types.ts`
- Modify: `packages/core/src/settings/schema.ts`
- Modify: `packages/core/src/settings/defaults.ts`
- Test: `packages/core/test/settings-media.test.ts` (create)

**Interfaces:**
- Produces: `SiteSettings.media: { imageFormat: 'webp'|'avif'|'both'; imageLqip: boolean }`; `parseSettings` fills media defaults (`imageFormat: 'webp'`, `imageLqip: false`).

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/settings-media.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSettings } from '../src/settings/schema'

describe('media settings', () => {
  it('defaults media.imageFormat=webp and imageLqip=false when absent', () => {
    const s = parseSettings({ general: { title: 'X' } })
    expect(s.media.imageFormat).toBe('webp')
    expect(s.media.imageLqip).toBe(false)
  })
  it('parses provided media settings', () => {
    const s = parseSettings({ media: { imageFormat: 'both', imageLqip: true } })
    expect(s.media).toEqual({ imageFormat: 'both', imageLqip: true })
  })
  it('falls back to default on an invalid imageFormat', () => {
    const s = parseSettings({ media: { imageFormat: 'jpeg', imageLqip: true } })
    expect(s.media.imageFormat).toBe('webp')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/core test settings-media`
Expected: FAIL — `s.media` undefined.

- [ ] **Step 3: Add the type**

In `packages/core/src/settings/types.ts`, add:

```ts
/** The Media settings group — drives the image pipeline (variant formats + LQIP). */
export interface MediaSettings {
  imageFormat: 'webp' | 'avif' | 'both'
  imageLqip: boolean
}
```

and add `media: MediaSettings` to `interface SiteSettings`.

- [ ] **Step 4: Add the schema + default**

In `packages/core/src/settings/schema.ts`, add a `mediaSchema` (mirroring `generalSchema` style) and wire it into the top-level object + `parseSettings`:

```ts
const mediaSchema = z
  .object({
    imageFormat: z.enum(['webp', 'avif', 'both']),
    imageLqip: z.boolean(),
  })
  .partial()
```

Add `media: mediaSchema.optional()` to the top-level `.object({ general: …, reading: …, media: … })`. In `parseSettings`, after the existing groups, add:

```ts
  const media = (data.media ?? {}) as Partial<SiteSettings['media']>
  const validFormat = (['webp', 'avif', 'both'] as const).includes(media.imageFormat as never)
  // … include in the returned object:
  media: {
    imageFormat: validFormat ? (media.imageFormat as SiteSettings['media']['imageFormat']) : DEFAULT_SETTINGS.media.imageFormat,
    imageLqip: typeof media.imageLqip === 'boolean' ? media.imageLqip : DEFAULT_SETTINGS.media.imageLqip,
  },
```

(Read the current `parseSettings` return literal first and add the `media` key alongside `general`/`reading`, matching its exact construction style.)

In `packages/core/src/settings/defaults.ts`, add to `DEFAULT_SETTINGS`:

```ts
  media: { imageFormat: 'webp', imageLqip: false },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @setu/core test settings-media && pnpm --filter @setu/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/settings/types.ts packages/core/src/settings/schema.ts packages/core/src/settings/defaults.ts packages/core/test/settings-media.test.ts
git commit -m "feat(core): Media settings group (imageFormat webp/avif/both + imageLqip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: API — drive the pipeline from settings

**Files:**
- Modify: `apps/api/src/media.ts`
- Modify: `apps/api/test/media-upload.test.ts`, `apps/api/test/media-ingest-e2e.test.ts` (callers use `format:` / `imageConfig`)
- Test: add a case to `apps/api/test/media-upload.test.ts`

**Interfaces:**
- Consumes: `IngestInput.formats`/`.lqip` (Task 3); `SiteSettings.media` (Task 4).
- Produces: the upload handler maps the Media setting → `formats` + `lqip` and passes them to `ingestImage`. Helper `formatsFor(setting: 'webp'|'avif'|'both'): ImageFormat[]` (`'both'` → `['webp','avif']`, else `[setting]`).

- [ ] **Step 1: Write the failing test**

Read how `createMediaApi`/`createUploadApi` receives config (the `opts` around `media.ts:48-58`). It currently takes `imageConfig?: ImageConfig`. Add a way to supply the **media settings** (a `mediaSettings?: { imageFormat; imageLqip }` opt, or a `getSettings()` thunk — match the existing config-injection pattern). Then in `apps/api/test/media-upload.test.ts` add:

```ts
it('generates both formats + lqip when media settings say so', async () => {
  // build the api with mediaSettings { imageFormat: 'both', imageLqip: true } (mirror existing setup)
  // upload a PNG, then read the manifest from storage
  const manifest = /* parse storage.get(manifestKey(mediaKey)) */
  expect(new Set(manifest.variants.map((v) => v.format))).toEqual(new Set(['webp', 'avif']))
  expect(manifest.lqip).toMatch(/^data:image\/webp;base64,/)
})
```

(Fill the setup by mirroring the existing upload test in this file — same storage/adapter wiring, just pass the media settings.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/api test media-upload`
Expected: FAIL — only webp variants, no lqip.

- [ ] **Step 3: Implement**

In `apps/api/src/media.ts`:
- Add the helper near the top:

```ts
function formatsFor(setting: 'webp' | 'avif' | 'both'): ImageFormat[] {
  return setting === 'both' ? ['webp', 'avif'] : [setting]
}
```

- Replace `ImageConfig` usage so the format/lqip come from media settings. Accept `mediaSettings?: { imageFormat: 'webp'|'avif'|'both'; imageLqip: boolean }` in `opts` (default `{ imageFormat: 'webp', imageLqip: false }`); keep `widths` (still `[400,800,1200,1600]`).
- Change the `ingestImage(...)` call (≈line 91-93):

```ts
        manifest = await ingestImage(
          { image, storage },
          { mediaKey, bytes, originalKey: key,
            formats: formatsFor(media.imageFormat), widths, lqip: media.imageLqip },
        )
```

where `media = opts.mediaSettings ?? { imageFormat: 'webp', imageLqip: false }` and `widths = opts.widths ?? [400,800,1200,1600]`.

- In `apps/api/src/server.ts`, wire `mediaSettings` from the loaded site settings (`parseSettings` of `settings.json`) into `createUploadApi`. (Read `server.ts` for how settings are loaded; if settings aren't loaded there yet, load `settings.json` via the existing settings/storage path and pass `parseSettings(...).media`.)

- Update `apps/api/test/media-ingest-e2e.test.ts` and any other caller passing `format:`/`imageConfig` to the new shape.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/api test media && pnpm --filter @setu/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/media.ts apps/api/src/server.ts apps/api/test/media-upload.test.ts apps/api/test/media-ingest-e2e.test.ts
git commit -m "feat(api): drive variant formats + LQIP from Media settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: API — reprocess endpoint

**Files:**
- Modify: `apps/api/src/media.ts`
- Test: `apps/api/test/media-reprocess.test.ts` (create)

**Interfaces:**
- Produces: `POST /media/reprocess` — for every stored manifest, re-runs `ingestImage` on the stored original with current media settings, overwriting variants + manifest; returns `{ reprocessed: number }`. Requires `content.create` authz (mirror the upload route).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/media-reprocess.test.ts`:

```ts
// 1. build the api with mediaSettings { imageFormat: 'webp', imageLqip: false }; upload a PNG.
// 2. confirm the manifest has only webp variants, no lqip.
// 3. rebuild/reconfigure the api with mediaSettings { imageFormat: 'both', imageLqip: true }.
// 4. POST /media/reprocess (authorized actor).
// 5. re-read the manifest: now has webp+avif variants AND an lqip data-URI.
describe('POST /media/reprocess', () => {
  it('regenerates every image with current settings', async () => {
    // …setup per above…
    const res = await app.request('/media/reprocess', { method: 'POST', headers: authHeaders })
    expect(res.status).toBe(200)
    expect((await res.json()).reprocessed).toBe(1)
    const m = /* parse storage manifest */
    expect(new Set(m.variants.map((v) => v.format))).toEqual(new Set(['webp', 'avif']))
    expect(m.lqip).toBeTruthy()
  })
})
```

(Mirror the existing upload-test setup for storage/auth wiring.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/api test media-reprocess`
Expected: FAIL — route 404.

- [ ] **Step 3: Implement the route**

In `apps/api/src/media.ts`, add after the upload route:

```ts
  app.post('/media/reprocess', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'content.create')) return c.json({ error: 'forbidden' }, 403)
    const media = opts.mediaSettings ?? { imageFormat: 'webp', imageLqip: false }
    const widths = opts.widths ?? [400, 800, 1200, 1600]
    const keys = await storage.list()
    const manifestKeys = keys.filter((k) => k.endsWith('.manifest.json')) // confirm manifestKey() suffix
    let reprocessed = 0
    for (const mk of manifestKeys) {
      const raw = await storage.get(mk)
      if (!raw) continue
      const old = JSON.parse(new TextDecoder().decode(raw)) as MediaManifest
      const orig = await storage.get(old.original.key)
      if (!orig) continue
      await ingestImage(
        { image, storage },
        { mediaKey: old.id, bytes: orig, originalKey: old.original.key,
          formats: formatsFor(media.imageFormat), widths, lqip: media.imageLqip },
      )
      reprocessed += 1
    }
    return c.json({ reprocessed })
  })
```

Confirm the manifest-key suffix via `manifestKey()` (don't hardcode if it differs). `TextDecoder` is universal; declare it locally if the edge tsconfig complains (mirror the `TextEncoder` pattern in `ingest.ts`) — but `media.ts` is Node, so it's fine.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/api test media-reprocess && pnpm --filter @setu/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/media.ts apps/api/test/media-reprocess.test.ts
git commit -m "feat(api): POST /media/reprocess — regenerate all images with current settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Renderer — multi-format + lqip in the markup model

**Files:**
- Modify: `packages/image-astro/src/lib/image-markup.ts`
- Modify: `packages/image-astro/test/image-markup.test.ts`

**Interfaces:**
- Consumes: `MediaManifest` with tagged variants + `lqip` (Task 1).
- Produces: `imageMarkup` returns `ImageMarkup` = `{ src, alt, title?, sources?: { type: string; srcset: string }[], srcset?, sizes?, width?, height?, lqip? }`. When >1 format present → `sources` (AVIF first, then WebP) populated and `srcset` set to the fallback (`manifest.format`) format's ladder; single format → `srcset` only (no `sources`). `lqip` passed through.

- [ ] **Step 1: Write the failing test**

In `packages/image-astro/test/image-markup.test.ts` add:

```ts
it('emits <picture> sources (avif first) for a multi-format manifest', () => {
  const manifest = { id:'x', format:'webp',
    original:{ key:'x.png', width:1600, height:900, format:'png' },
    variants:[
      { width:800, height:450, key:'x-w800.webp', contentType:'image/webp', format:'webp' },
      { width:800, height:450, key:'x-w800.avif', contentType:'image/avif', format:'avif' },
    ] }
  const out = imageMarkup({ manifest, resolvedSrc:'/o.png', alt:'a', resolveUrl:(s)=>s, sizes:'100vw' })
  expect(out.sources!.map((s)=>s.type)).toEqual(['image/avif','image/webp'])
  expect(out.sources![0].srcset).toContain('x-w800.avif 800w')
  expect(out.srcset).toContain('x-w800.webp 800w') // <img> fallback = manifest.format (webp)
})

it('passes lqip through and omits sources for single-format', () => {
  const manifest = { id:'x', format:'webp',
    original:{ key:'x.png', width:1600, height:900, format:'png' },
    variants:[{ width:800, height:450, key:'x-w800.webp', contentType:'image/webp', format:'webp' }],
    lqip:'data:image/webp;base64,AA' }
  const out = imageMarkup({ manifest, resolvedSrc:'/o.png', alt:'a', resolveUrl:(s)=>s, sizes:'100vw' })
  expect(out.sources).toBeUndefined()
  expect(out.lqip).toBe('data:image/webp;base64,AA')
})
```

(Keep the existing single-format test green — it should still produce `srcset` and no `sources`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/image-astro test image-markup`
Expected: FAIL — `sources`/`lqip` undefined on the type/return.

- [ ] **Step 3: Implement**

Replace the body of `imageMarkup` in `packages/image-astro/src/lib/image-markup.ts` (and extend `ImageAttrs` → rename to `ImageMarkup` with the new fields; update the export):

```ts
export interface ImageSource { type: string; srcset: string }
export interface ImageMarkup {
  src: string
  alt: string
  title?: string
  sources?: ImageSource[]
  srcset?: string
  sizes?: string
  width?: number
  height?: number
  lqip?: string
}

const TYPE_BY_FORMAT: Record<string, string> = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' }
// <picture> source order: best (smallest) first.
const FORMAT_ORDER = ['avif', 'webp', 'jpeg', 'png']

export function imageMarkup(input: ImageMarkupInput): ImageMarkup {
  const { manifest, resolvedSrc, alt, title, resolveUrl, sizes } = input
  if (!manifest || manifest.variants.length === 0) {
    return { src: resolvedSrc, alt, title }
  }
  const fmtOf = (v: { format?: string }) => v.format ?? manifest.format
  const byFormat = new Map<string, typeof manifest.variants>()
  for (const v of manifest.variants) {
    const f = fmtOf(v)
    ;(byFormat.get(f) ?? byFormat.set(f, []).get(f)!).push(v)
  }
  const srcsetFor = (vs: typeof manifest.variants) =>
    vs.map((v) => `${resolveUrl(`/media/${v.key}`)} ${v.width}w`).join(', ')

  const base: ImageMarkup = {
    src: resolvedSrc, alt, title, sizes,
    width: manifest.original.width, height: manifest.original.height,
    ...(manifest.lqip ? { lqip: manifest.lqip } : {}),
  }

  if (byFormat.size <= 1) {
    return { ...base, srcset: srcsetFor(manifest.variants) }
  }
  const sources: ImageSource[] = FORMAT_ORDER.filter((f) => byFormat.has(f)).map((f) => ({
    type: TYPE_BY_FORMAT[f] ?? `image/${f}`,
    srcset: srcsetFor(byFormat.get(f)!),
  }))
  // <img> fallback uses the manifest's primary format ladder.
  return { ...base, sources, srcset: srcsetFor(byFormat.get(manifest.format) ?? manifest.variants) }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/image-astro test image-markup && pnpm --filter @setu/image-astro typecheck`
Expected: PASS (incl. the pre-existing single-format test).

- [ ] **Step 5: Commit**

```bash
git add packages/image-astro/src/lib/image-markup.ts packages/image-astro/test/image-markup.test.ts
git commit -m "feat(image-astro): markup model emits <picture> sources + lqip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Renderer — Image.astro / ImageFigure.astro (`<picture>` + blur-up)

**Files:**
- Modify: `packages/image-astro/src/Image.astro`
- Modify: `packages/image-astro/src/ImageFigure.astro`
- Modify: `packages/image-astro/src/lib/blur-up.css` (create) — wrapper styles
- Test: none (Astro SSR markup; validated at the Task 10 gate + the markup unit tests in Task 7)

**Interfaces:**
- Consumes: `imageMarkup(...)` → `ImageMarkup` (Task 7).

- [ ] **Step 1: Update Image.astro to render picture + blur-up**

Read the current `Image.astro` first. Replace the single `<img>` output with this structure (keep the existing prop parsing / `imageMarkup` call):

```astro
---
// …existing imports + const a = imageMarkup({...})…
const blur = a.lqip
  ? `background-image:url(${a.lqip});background-size:cover;background-position:center;`
  : undefined
---
{a.sources ? (
  <span class={blur ? 'setu-img blk-blurup' : 'setu-img'} style={blur} data-blurup={blur ? '' : undefined}>
    <picture>
      {a.sources.map((s) => <source type={s.type} srcset={s.srcset} sizes={a.srcset ? a.sizes : undefined} />)}
      <img src={a.src} srcset={a.srcset} sizes={a.srcset ? a.sizes : undefined}
           width={a.width} height={a.height} alt={a.alt} title={a.title}
           loading="lazy" decoding="async" onload="this.parentElement.parentElement.classList.add('is-loaded')" />
    </picture>
  </span>
) : (
  <span class={blur ? 'setu-img blk-blurup' : 'setu-img'} style={blur} data-blurup={blur ? '' : undefined}>
    <img src={a.src} srcset={a.srcset} sizes={a.srcset ? a.sizes : undefined}
         width={a.width} height={a.height} alt={a.alt} title={a.title}
         loading="lazy" decoding="async" onload="this.parentElement.classList.add('is-loaded')" />
  </span>
)}
```

(If `a.srcset` is undefined — no manifest — render the plain `<img>` as today, no wrapper.) The `onload` inline handler is the "tiny shared script" — it adds `is-loaded` so CSS can fade. Keep markup identical in `ImageFigure.astro` (it wraps the same `<img>` in a `<figure>`).

- [ ] **Step 2: Add the blur-up CSS**

Create `packages/image-astro/src/lib/blur-up.css` and import it from `Image.astro`/`ImageFigure.astro` (Astro hoists/dedupes):

```css
.blk-blurup { display: inline-block; position: relative; overflow: hidden; }
.blk-blurup > picture > img,
.blk-blurup > img { display: block; width: 100%; height: auto; opacity: 0; transition: opacity .5s ease; }
.blk-blurup.is-loaded > picture > img,
.blk-blurup.is-loaded > img { opacity: 1; }
/* No-JS / already-cached: if the image is complete before hydration, reveal it. */
@media (scripting: none) { .blk-blurup > picture > img, .blk-blurup > img { opacity: 1; } }
```

- [ ] **Step 3: Verify the markup renders (build smoke)**

Run: `pnpm --filter @setu/image-astro test` (markup unit tests still green) and `pnpm --filter @setu/image-astro typecheck`.
Expected: PASS. (Full visual verification is the Task 10 gate.)

- [ ] **Step 4: Commit**

```bash
git add packages/image-astro/src/Image.astro packages/image-astro/src/ImageFigure.astro packages/image-astro/src/lib/blur-up.css
git commit -m "feat(image-astro): render <picture> + LQIP blur-up (fade on load)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Admin — Settings → Media + Reprocess

**Files:**
- Modify/Create under `apps/admin/src/screens` (the Settings screen) — a **Media** section
- Test: `apps/admin/test/settings-media.test.tsx` (create)

**Interfaces:**
- Consumes: the settings load/save flow the existing General settings section uses; the `POST /media/reprocess` endpoint (Task 6).

- [ ] **Step 1: Find the settings screen + write a failing test**

Read how the existing **General** settings section renders + saves (grep `settings` under `apps/admin/src/screens`). Create `apps/admin/test/settings-media.test.tsx` that renders the Media section and asserts: a **Format** select with options WebP/AVIF/Both, an **LQIP** switch, and a **Reprocess** button that, on click, calls the reprocess endpoint and shows the local-run warning text. Mirror the existing settings-section test patterns.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @setu/admin test settings-media`
Expected: FAIL — Media section not present.

- [ ] **Step 3: Build the Media section**

Add a Media section to the Settings screen, following the existing General-section pattern and shadcn-first (use the installed `Select`, `Switch`, `Button`, `Alert`/`AlertDialog` from `@/components/ui`):
- **Image format** — `Select` bound to `settings.media.imageFormat` (WebP / AVIF / Both), saved through the same settings-save path.
- **Blur-up placeholders (LQIP)** — `Switch` bound to `settings.media.imageLqip`.
- **Reprocess all images** — a `Button` that POSTs `/media/reprocess`; gate it behind an `AlertDialog` whose body warns: *"Re-encodes every image with the current format/LQIP settings. This is heavy — especially AVIF — and is best run locally, not on a deployed site."* On confirm, call the endpoint, then toast the `{ reprocessed }` count.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test settings-media && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/screens apps/admin/test/settings-media.test.tsx
git commit -m "feat(admin): Settings → Media (format + LQIP) + Reprocess with local-run warning

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Live UAT gate (Definition of Done)

**Files:** none. Uses the dev stack from the worktree.

- [ ] **Step 1: Full check**

Run: `pnpm -r typecheck && pnpm --filter @setu/core test && pnpm --filter @setu/image-sharp test && pnpm --filter @setu/image-astro test && pnpm --filter @setu/api test && pnpm --filter @setu/admin test`
Expected: all PASS (pre-existing unrelated failures, e.g. the recipe `{% query %}` sandbox break, excepted — note them).

- [ ] **Step 2: Drive it live**

From the worktree, run the dev stack (`pnpm dev`). In Settings → Media: set format to **Both**, toggle **LQIP on**, save. Upload a new image (Media or the image block). Confirm on the site: the image renders inside a `<picture>` with `image/avif` + `image/webp` sources, a base64 blurred placeholder shows then **fades** to the sharp image, and there's **no layout shift**. Switch format to **AVIF**, re-upload, confirm a single AVIF ladder. Toggle LQIP off, confirm plain `<img>`.

- [ ] **Step 3: Reprocess**

With Both + LQIP on, click **Reprocess all images** (accept the warning), then reload an *existing* page image and confirm it now has `<picture>` + blur-up.

- [ ] **Step 4: Self-critique (DoD)**

Driven live ✓, matches the spec ✓, reuses the shared pipeline/renderer (hero + image block + inline all get it) ✓, no skeleton (format + LQIP + reprocess all real) ✓. Then ready for whole-branch review.
