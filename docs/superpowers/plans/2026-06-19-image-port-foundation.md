# ImagePort Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dumb image transform engine — `ImagePort` (edge-safe interface in `@setu/core`) + a contract battery + a sharp-on-Node adapter — that resizes and re-encodes image bytes into named variants.

**Architecture:** Mirrors the shipped `StoragePort` increment exactly: a pure-types port in `@setu/core` (covered by the edge guard), a `@setu/image-testing` behavioural battery any adapter runs, and the first real adapter `@setu/image-sharp`. No wiring, persistence, or render — that is #4b/#4c.

**Tech Stack:** TypeScript, `sharp` 0.35 (libvips, Node-only), Vitest. A self-contained runtime PNG encoder provides test fixtures (no binary blobs, no sharp dependency to *make* fixtures).

## Global Constraints

- **The `ImagePort` interface + types live in `@setu/core` and stay edge/browser-safe** — no Node/DOM APIs; covered by the edge guard `packages/core/tsconfig.edge.json` (which sets `types: []` and must be extended to include `src/image`). `@setu/core`'s `typecheck` runs `tsc --noEmit && tsc -p tsconfig.edge.json --noEmit`.
- **`sharp` is a runtime dependency of `@setu/image-sharp` ONLY** — never of `@setu/core`. Version `^0.35.1` (Apache-2.0, prebuilt binaries, requires Node ≥ 20.9 — we run Node 22).
- **The port is dumb:** `generate(source, specs[])` produces one output per spec, in order. **Never upscale** (`outputWidth = min(spec.width, sourceWidth)`); **preserve aspect ratio** (no crop — focal/crop is #4d); re-encode to `spec.format` at `spec.quality` (1–100) or a per-format default. `contentType` matches the format.
- **Per-format default quality:** AVIF 55, WebP 75, JPEG 80, PNG lossless (no quality).
- **No reference adapter** (a transform engine can't be meaningfully faked) — the battery self-tests against the real sharp adapter. Output **format** is verified by **magic bytes** (`detectFormat`), not sharp's `metadata().format` name (which is version-dependent for AVIF/HEIF); output **dimensions** are verified via the adapter's `metadata()`.
- **Patterns to mirror exactly:** `@setu/storage-testing` (battery package — vitest peerDep, `runStoragePortContract` shape) and `@setu/storage-local` (adapter package — `tsconfig.json` = `{ extends base, noEmit, types: [], include: ["src","test"] }`; `contract.test.ts` runs the battery; license `AGPL-3.0-only`; `type: module`).
- **Out of scope** (later #4 slices): generate-on-upload/persist/manifest (#4b), srcset/`<picture>` render (#4c), focal/crop (#4d), per-image quality UI (#4e), queued generation (#4f), the CF-Images edge adapter, theme-declared sizes.

---

### Task 1: `ImagePort` interface in `@setu/core` + edge guard

**Files:**
- Create: `packages/core/src/image/image-port.ts`
- Modify: `packages/core/src/index.ts` (export the image types)
- Modify: `packages/core/tsconfig.edge.json` (add `src/image` to `include`)

**Interfaces:**
- Produces (consumed by Tasks 2–3 and later #4 slices):
  - `type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png'`
  - `interface VariantSpec { name: string; width: number; format: ImageFormat; quality?: number }`
  - `interface ImageMeta { width: number; height: number; format: string }`
  - `interface GeneratedVariant { name: string; width: number; height: number; format: ImageFormat; contentType: string; body: Uint8Array }`
  - `interface ImagePort { metadata(source: Uint8Array): Promise<ImageMeta>; generate(source: Uint8Array, specs: VariantSpec[]): Promise<GeneratedVariant[]> }`

- [ ] **Step 1: Write the interface**

`packages/core/src/image/image-port.ts`:
```ts
// @setu/core/src/image/image-port.ts — a dumb image transform engine (edge-safe types).
export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png'

/** One requested output: a named variant at a target width + format (+ optional quality 1–100). */
export interface VariantSpec {
  name: string
  width: number
  format: ImageFormat
  quality?: number
}

/** Intrinsic properties of a source image. */
export interface ImageMeta {
  width: number
  height: number
  format: string
}

/** A produced variant — the bytes plus the actual dimensions / format / content-type. */
export interface GeneratedVariant {
  name: string
  width: number
  height: number
  format: ImageFormat
  contentType: string
  body: Uint8Array
}

export interface ImagePort {
  /** Intrinsic width / height / format of the source bytes. */
  metadata(source: Uint8Array): Promise<ImageMeta>
  /** Produce one output per spec, in order. Never upscales; preserves aspect ratio. */
  generate(source: Uint8Array, specs: VariantSpec[]): Promise<GeneratedVariant[]>
}
```

- [ ] **Step 2: Export from the core barrel**

In `packages/core/src/index.ts`, add (next to the `StoragePort` export on line 24):
```ts
export type { ImageFormat, VariantSpec, ImageMeta, GeneratedVariant, ImagePort } from './image/image-port'
```

- [ ] **Step 3: Add `src/image` to the edge guard**

In `packages/core/tsconfig.edge.json`, add `"src/image"` to the `include` array (e.g. right after `"src/storage"`):
```json
  "include": ["src/markdoc", "src/data", "src/storage", "src/image", "src/authoring", "src/git", "src/publish", "src/read", "src/authz", "src/lifecycle", "src/content-index", "src/url"]
```

- [ ] **Step 4: Verify typecheck + edge guard pass**

Run: `pnpm --filter @setu/core typecheck`
Expected: PASS — both `tsc --noEmit` and `tsc -p tsconfig.edge.json --noEmit` succeed (the interface is pure types, no Node/DOM).

- [ ] **Step 5: Adversarial edge-guard check (then revert)**

Temporarily add `import { Buffer } from 'node:buffer'` to the top of `image-port.ts` and re-run `pnpm --filter @setu/core typecheck`.
Expected: the edge-guard pass (`tsc -p tsconfig.edge.json`) **FAILS** (Node types unavailable under `types: []`), proving `src/image` is guarded. **Remove the import** and confirm typecheck passes again.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/image/image-port.ts packages/core/src/index.ts packages/core/tsconfig.edge.json
git commit -m "feat(core): ImagePort interface — dumb image transform engine (edge-safe)"
```

---

### Task 2: `@setu/image-testing` — contract battery + fixture encoder

**Files:**
- Create: `packages/image-testing/package.json`
- Create: `packages/image-testing/tsconfig.json`
- Create: `packages/image-testing/src/png.ts`
- Create: `packages/image-testing/src/index.ts`
- Test: `packages/image-testing/test/png.test.ts`

**Interfaces:**
- Consumes: `ImageFormat`, `ImagePort`, `VariantSpec` from `@setu/core`.
- Produces:
  - `makeTestPng(width: number, height: number): Uint8Array` — a deterministic gradient RGB PNG (real, decodable).
  - `detectFormat(bytes: Uint8Array): ImageFormat | null` — magic-byte format sniff.
  - `runImagePortContract(makeAdapter: () => Promise<ImagePort> | ImagePort): void` — the Vitest battery.

- [ ] **Step 1: Create the package manifest**

`packages/image-testing/package.json`:
```json
{
  "name": "@setu/image-testing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "peerDependencies": { "vitest": "^2.0.0" },
  "devDependencies": { "@types/node": "^22.10.2", "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

`packages/image-testing/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

Then run `pnpm install` (from the repo root) so the new workspace package is linked.

- [ ] **Step 2: Write the PNG encoder**

`packages/image-testing/src/png.ts`:
```ts
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import type { ImageFormat } from '@setu/core'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xed_b8_83_20 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

/** A deterministic gradient RGB PNG of the given size — a real, decodable image with
 *  enough detail that lossy re-encoding at different qualities yields different sizes. */
export function makeTestPng(width: number, height: number): Uint8Array {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 3)
    raw[off] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 3
      raw[p] = (x * 37 + y * 17) & 255
      raw[p + 1] = (x * x + y * 3) & 255
      raw[p + 2] = ((x ^ y) * 53) & 255
    }
  }
  const idat = deflateSync(raw, { level: 9 })
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]))
}

/** Identify an encoded image's format from its magic bytes (version-independent —
 *  unlike sharp's metadata().format, which reports HEIF/AVIF inconsistently). */
export function detectFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  )
    return 'webp'
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    // ISO-BMFF "ftyp" box — AVIF major/compatible brand begins "avi" (avif/avis)
    if (b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69) return 'avif'
  }
  return null
}
```

- [ ] **Step 3: Write the battery**

`packages/image-testing/src/index.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { ImageFormat, ImagePort, VariantSpec } from '@setu/core'
import { makeTestPng, detectFormat } from './png'

export { makeTestPng, detectFormat } from './png'

const CONTENT_TYPE: Record<ImageFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/** Run the ImagePort behavioural contract against an adapter. `makeAdapter` returns a
 *  ready adapter on each call. */
export function runImagePortContract(makeAdapter: () => Promise<ImagePort> | ImagePort): void {
  describe('ImagePort contract', () => {
    const source = makeTestPng(200, 120)
    let port: ImagePort
    beforeEach(async () => {
      port = await makeAdapter()
    })

    it('reads intrinsic metadata of the source', async () => {
      const m = await port.metadata(source)
      expect(m.width).toBe(200)
      expect(m.height).toBe(120)
      expect(m.format).toBe('png')
    })

    it('returns one variant per spec, in order, with names echoed', async () => {
      const specs: VariantSpec[] = [
        { name: 'a', width: 100, format: 'webp' },
        { name: 'b', width: 50, format: 'jpeg' },
      ]
      const out = await port.generate(source, specs)
      expect(out.map((v) => v.name)).toEqual(['a', 'b'])
    })

    it('resizes to the requested width, preserving aspect ratio', async () => {
      const [v] = await port.generate(source, [{ name: 'a', width: 100, format: 'webp' }])
      expect(v.width).toBe(100)
      expect(v.height).toBe(60) // 120 * 100 / 200
      const m = await port.metadata(v.body)
      expect(m.width).toBe(100)
      expect(m.height).toBe(60)
    })

    it('never upscales — a width beyond the source clamps to the source width', async () => {
      const [v] = await port.generate(source, [{ name: 'big', width: 400, format: 'webp' }])
      expect(v.width).toBe(200)
      expect(v.height).toBe(120)
    })

    it('encodes to the requested format with the matching content-type', async () => {
      const out = await port.generate(source, [
        { name: 'w', width: 80, format: 'webp' },
        { name: 'j', width: 80, format: 'jpeg' },
        { name: 'p', width: 80, format: 'png' },
      ])
      for (const v of out) {
        expect(v.contentType).toBe(CONTENT_TYPE[v.format])
        expect(detectFormat(v.body)).toBe(v.format)
      }
    })

    it('returns [] for an empty spec list', async () => {
      expect(await port.generate(source, [])).toEqual([])
    })
  })
}
```

- [ ] **Step 4: Write the fixture self-test (failing first)**

`packages/image-testing/test/png.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTestPng, detectFormat } from '../src/index'

describe('makeTestPng', () => {
  it('produces a valid PNG (signature + detectable format)', () => {
    const png = makeTestPng(200, 120)
    expect(png.length).toBeGreaterThan(8)
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(detectFormat(png)).toBe('png')
  })

  it('is deterministic for the same dimensions', () => {
    expect(Array.from(makeTestPng(32, 16))).toEqual(Array.from(makeTestPng(32, 16)))
  })

  it('detectFormat returns null for non-image bytes', () => {
    expect(detectFormat(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})
```

- [ ] **Step 5: Run the self-test + typecheck**

Run: `pnpm --filter @setu/image-testing test && pnpm --filter @setu/image-testing typecheck`
Expected: PASS (3 tests) + typecheck clean. (The `runImagePortContract` battery itself is exercised in Task 3 — it needs a real adapter.)

- [ ] **Step 6: Commit**

```bash
git add packages/image-testing pnpm-lock.yaml
git commit -m "feat(image-testing): ImagePort contract battery + deterministic PNG fixture encoder"
```

---

### Task 3: `@setu/image-sharp` — the sharp-on-Node adapter

**Files:**
- Create: `packages/image-sharp/package.json`
- Create: `packages/image-sharp/tsconfig.json`
- Create: `packages/image-sharp/src/index.ts`
- Test: `packages/image-sharp/test/contract.test.ts`
- Test: `packages/image-sharp/test/sharp.test.ts`

**Interfaces:**
- Consumes: `GeneratedVariant`, `ImageFormat`, `ImagePort`, `VariantSpec` from `@setu/core`; `runImagePortContract`, `makeTestPng`, `detectFormat` from `@setu/image-testing`.
- Produces: `createSharpImageAdapter(): ImagePort`.

- [ ] **Step 1: Create the package manifest**

`packages/image-sharp/package.json`:
```json
{
  "name": "@setu/image-sharp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*", "sharp": "^0.35.1" },
  "devDependencies": {
    "@setu/image-testing": "workspace:*",
    "@types/node": "^22.10.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`packages/image-sharp/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

Then run `pnpm install` (from the repo root) — this installs `sharp` (prebuilt binary) and links the workspace package.

- [ ] **Step 2: Write the contract test (failing first)**

`packages/image-sharp/test/contract.test.ts`:
```ts
import { runImagePortContract } from '@setu/image-testing'
import { createSharpImageAdapter } from '../src/index'

runImagePortContract(() => createSharpImageAdapter())
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @setu/image-sharp test contract`
Expected: FAIL — cannot find `../src/index` (the adapter doesn't exist yet).

- [ ] **Step 4: Write the adapter**

`packages/image-sharp/src/index.ts`:
```ts
import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import type { GeneratedVariant, ImageFormat, ImageMeta, ImagePort, VariantSpec } from '@setu/core'

const CONTENT_TYPE: Record<ImageFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/** Conservative per-format defaults (good size/quality). PNG is lossless — no quality. */
const DEFAULT_QUALITY: Record<ImageFormat, number | undefined> = {
  avif: 55,
  webp: 75,
  jpeg: 80,
  png: undefined,
}

/** A sharp/libvips ImagePort — resizes (never enlarging) + re-encodes to the requested format. */
export function createSharpImageAdapter(): ImagePort {
  return {
    async metadata(source: Uint8Array): Promise<ImageMeta> {
      const m = await sharp(Buffer.from(source)).metadata()
      return { width: m.width ?? 0, height: m.height ?? 0, format: String(m.format ?? '') }
    },

    async generate(source: Uint8Array, specs: VariantSpec[]): Promise<GeneratedVariant[]> {
      const out: GeneratedVariant[] = []
      for (const spec of specs) {
        const quality = spec.quality ?? DEFAULT_QUALITY[spec.format]
        const resized = sharp(Buffer.from(source)).resize(spec.width, null, { withoutEnlargement: true })
        const encoded = resized.toFormat(spec.format, quality !== undefined ? { quality } : {})
        const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
        out.push({
          name: spec.name,
          width: info.width,
          height: info.height,
          format: spec.format,
          contentType: CONTENT_TYPE[spec.format],
          body: new Uint8Array(data),
        })
      }
      return out
    },
  }
}
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `pnpm --filter @setu/image-sharp test contract`
Expected: PASS — the full `ImagePort contract` battery (6 tests) is green against sharp.

- [ ] **Step 6: Write the targeted adapter tests**

`packages/image-sharp/test/sharp.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTestPng, detectFormat } from '@setu/image-testing'
import { createSharpImageAdapter } from '../src/index'

const source = makeTestPng(200, 120)

describe('createSharpImageAdapter', () => {
  it('encodes AVIF (the slow path) with the right content-type and dims', async () => {
    const port = createSharpImageAdapter()
    const [v] = await port.generate(source, [{ name: 'a', width: 80, format: 'avif' }])
    expect(v.contentType).toBe('image/avif')
    expect(detectFormat(v.body)).toBe('avif')
    expect(v.width).toBe(80)
    expect(v.height).toBe(48) // 120 * 80 / 200
  })

  it('honours a quality override — lower quality yields a smaller body', async () => {
    const port = createSharpImageAdapter()
    const [lo] = await port.generate(source, [{ name: 'lo', width: 200, format: 'webp', quality: 30 }])
    const [hi] = await port.generate(source, [{ name: 'hi', width: 200, format: 'webp', quality: 90 }])
    expect(lo.body.length).toBeLessThan(hi.body.length)
  })

  it('throws on bytes that are not a decodable image', async () => {
    const port = createSharpImageAdapter()
    await expect(port.metadata(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })
})
```

- [ ] **Step 7: Run the targeted tests + typecheck**

Run: `pnpm --filter @setu/image-sharp test && pnpm --filter @setu/image-sharp typecheck`
Expected: PASS (6 contract + 3 targeted = 9 tests) + typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/image-sharp pnpm-lock.yaml
git commit -m "feat(image-sharp): sharp-on-Node ImagePort adapter (resize + re-encode)"
```

---

## Final verification (after all tasks)

- [ ] Full suite + typecheck across the workspace:
  - `pnpm -r test`
  - `pnpm -r typecheck`
  - Expected: all green — `@setu/core` (incl. edge guard over `src/image`), `@setu/image-testing` (fixtures), `@setu/image-sharp` (contract battery + targeted).

## Notes for the executor

- **`sharp` is a native module** — `pnpm install` fetches a prebuilt binary for this platform (macOS/Linux); no system libvips needed. If install is slow, that's the binary download, not a hang.
- **`@setu/core` stays sharp-free** — only `@setu/image-sharp` depends on sharp. If a task seems to need sharp (or any `node:*`) inside `@setu/core`, stop — the edge guard will reject it and the design forbids it.
- **Verify output format via `detectFormat` (magic bytes), not sharp's `metadata().format`** — for AVIF, libvips may report `heif`; the magic-byte sniff is the reliable check.
- **Mirror the storage packages** (`@setu/storage-testing`, `@setu/storage-local`) for any structural question — same `tsconfig.json`, same license, same package shape.
