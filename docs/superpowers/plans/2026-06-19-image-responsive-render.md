# Responsive Image Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Image.astro` emit a responsive `<img srcset sizes width height>` from the variant manifest (#4b) at build time, falling back to the plain `<img>` (#3) when no manifest exists.

**Architecture:** A pure attrs-builder (`imageMarkup`) + a build-time manifest loader (`loadManifest` reading `${SETU_MEDIA_DIR}/media/<id>/manifest.json` via `node:fs`) wired into `Image.astro`. Zero per-render cost — the build reads a small JSON and emits static srcset.

**Tech Stack:** Astro 6 (SSG, Node build), `@setu/core` (`MediaManifest`), Vitest.

## Global Constraints

- **Manifest source = build-time FS read of `${SETU_MEDIA_DIR}/media/<id>/manifest.json`.** `SETU_MEDIA_DIR` (FS path, server-only — NOT `PUBLIC_`) is **distinct** from `PUBLIC_SETU_MEDIA` (URL origin, the #3 resolver). Edge manifest source (R2) is deferred — a swap behind `loadManifest`.
- **`loadManifest` NEVER throws** — unset env / missing file / unparseable / wrong shape → `null` → plain `<img>`. A zero-variant manifest is treated as no manifest.
- **Graceful degradation:** external/absolute srcs, non-`/uploads/` srcs, and manifest-less images render the exact #3 plain `<img>` (`src` resolved against `PUBLIC_SETU_MEDIA`, `loading="lazy" decoding="async"`). Never a broken image or build failure.
- **With a manifest:** `src` = the resolved original; `srcset` = `variants.map(v => \`${resolveUrl('/uploads/'+v.key)} ${v.width}w\`).join(', ')`; `sizes` (default **`100vw`**, prop-overridable); `width`/`height` from `manifest.original`.
- **Reuse the #3 resolver verbatim:** `resolveUrl(s)` = leave empty/absolute `http(s)://` alone, else prepend `(PUBLIC_SETU_MEDIA ?? 'http://localhost:4444')` (trailing slash stripped) to a `/`-rooted path.
- `MediaManifest` (from `@setu/core`): `{ id, format, original:{key,width,height,format}, variants:[{width,height,key,contentType}] }`.
- **Patterns to mirror:** site unit tests in `apps/site/test/` (Vitest, Node APIs); `apps/site/test/render.test.ts` (full `pnpm build` via `execSync` in `beforeAll`, asserts kitchen-sink HTML).

---

### Task 1: `imageMarkup` — the pure attrs builder

**Files:**
- Create: `apps/site/src/lib/image-markup.ts`
- Test: `apps/site/test/image-markup.test.ts`

**Interfaces:**
- Consumes: `MediaManifest` from `@setu/core`.
- Produces:
  - `interface ImageAttrs { src: string; alt: string; title?: string; srcset?: string; sizes?: string; width?: number; height?: number }`
  - `interface ImageMarkupInput { manifest: MediaManifest | null; resolvedSrc: string; alt: string; title?: string; resolveUrl: (rootRelative: string) => string; sizes: string }`
  - `imageMarkup(input: ImageMarkupInput): ImageAttrs`

- [ ] **Step 1: Write the failing test**

`apps/site/test/image-markup.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { MediaManifest } from '@setu/core'
import { imageMarkup } from '../src/lib/image-markup'

const resolveUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `http://cdn${s}`)
const manifest = (): MediaManifest => ({
  id: 'abc',
  format: 'webp',
  original: { key: 'media/abc/original.png', width: 1000, height: 600, format: 'png' },
  variants: [
    { width: 400, height: 240, key: 'media/abc/w400.webp', contentType: 'image/webp' },
    { width: 800, height: 480, key: 'media/abc/w800.webp', contentType: 'image/webp' },
  ],
})

describe('imageMarkup', () => {
  it('builds srcset + intrinsic dims from a manifest', () => {
    const a = imageMarkup({
      manifest: manifest(),
      resolvedSrc: 'http://cdn/uploads/media/abc/original.png',
      alt: 'cat',
      resolveUrl,
      sizes: '100vw',
    })
    expect(a.src).toBe('http://cdn/uploads/media/abc/original.png')
    expect(a.srcset).toBe('http://cdn/uploads/media/abc/w400.webp 400w, http://cdn/uploads/media/abc/w800.webp 800w')
    expect(a.sizes).toBe('100vw')
    expect(a.width).toBe(1000)
    expect(a.height).toBe(600)
    expect(a.alt).toBe('cat')
  })

  it('falls back to a plain image when the manifest is null', () => {
    const a = imageMarkup({ manifest: null, resolvedSrc: 'https://x/p.png', alt: 'ext', resolveUrl, sizes: '100vw' })
    expect(a).toEqual({ src: 'https://x/p.png', alt: 'ext', title: undefined })
    expect(a.srcset).toBeUndefined()
  })

  it('treats an empty-variants manifest as no manifest', () => {
    const a = imageMarkup({ manifest: { ...manifest(), variants: [] }, resolvedSrc: 'http://cdn/x.png', alt: 'a', resolveUrl, sizes: '100vw' })
    expect(a.srcset).toBeUndefined()
    expect(a.width).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/site test image-markup`
Expected: FAIL — cannot find `../src/lib/image-markup`.

- [ ] **Step 3: Implement**

`apps/site/src/lib/image-markup.ts`:
```ts
import type { MediaManifest } from '@setu/core'

export interface ImageAttrs {
  src: string
  alt: string
  title?: string
  srcset?: string
  sizes?: string
  width?: number
  height?: number
}

export interface ImageMarkupInput {
  manifest: MediaManifest | null
  /** The already-resolved (absolute) original URL. */
  resolvedSrc: string
  alt: string
  title?: string
  /** Resolves a root-relative `/uploads/<key>` to an absolute URL (the #3 resolver). */
  resolveUrl: (rootRelative: string) => string
  sizes: string
}

/** Build <img> attributes: a responsive srcset + intrinsic dims when a manifest is present,
 *  else a plain image (the #3 behaviour). Pure — no fs, no Astro. */
export function imageMarkup(input: ImageMarkupInput): ImageAttrs {
  const { manifest, resolvedSrc, alt, title, resolveUrl, sizes } = input
  if (!manifest || manifest.variants.length === 0) {
    return { src: resolvedSrc, alt, title }
  }
  const srcset = manifest.variants.map((v) => `${resolveUrl(`/uploads/${v.key}`)} ${v.width}w`).join(', ')
  return {
    src: resolvedSrc,
    alt,
    title,
    srcset,
    sizes,
    width: manifest.original.width,
    height: manifest.original.height,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @setu/site test image-markup`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/image-markup.ts apps/site/test/image-markup.test.ts
git commit -m "feat(site): imageMarkup — pure srcset/dims builder from a manifest"
```

---

### Task 2: `media-manifest` — build-time manifest discovery + load

**Files:**
- Create: `apps/site/src/lib/media-manifest.ts`
- Test: `apps/site/test/media-manifest.test.ts`

**Interfaces:**
- Consumes: `MediaManifest` from `@setu/core`.
- Produces:
  - `manifestIdFromSrc(src: string): string | null`
  - `loadManifest(id: string): MediaManifest | null`

- [ ] **Step 1: Write the failing test**

`apps/site/test/media-manifest.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { manifestIdFromSrc, loadManifest } from '../src/lib/media-manifest'

const dirs: string[] = []
const prev = process.env.SETU_MEDIA_DIR
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  if (prev === undefined) delete process.env.SETU_MEDIA_DIR
  else process.env.SETU_MEDIA_DIR = prev
})

function tmpWith(id: string, manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-'))
  dirs.push(dir)
  const md = join(dir, 'media', id)
  mkdirSync(md, { recursive: true })
  writeFileSync(join(md, 'manifest.json'), JSON.stringify(manifest))
  return dir
}

describe('manifestIdFromSrc', () => {
  it('extracts the id from a root-relative upload src', () => {
    expect(manifestIdFromSrc('/uploads/media/abc123/original.png')).toBe('abc123')
  })
  it('returns null for external or non-upload srcs', () => {
    expect(manifestIdFromSrc('https://example.com/p.png')).toBeNull()
    expect(manifestIdFromSrc('/assets/x.png')).toBeNull()
  })
})

describe('loadManifest', () => {
  const m = {
    id: 'abc',
    format: 'webp',
    original: { key: 'media/abc/original.png', width: 10, height: 6, format: 'png' },
    variants: [{ width: 400, height: 240, key: 'media/abc/w400.webp', contentType: 'image/webp' }],
  }
  it('reads + parses a manifest from SETU_MEDIA_DIR', () => {
    process.env.SETU_MEDIA_DIR = tmpWith('abc', m)
    expect(loadManifest('abc')).toEqual(m)
  })
  it('returns null when the env is unset', () => {
    delete process.env.SETU_MEDIA_DIR
    expect(loadManifest('abc')).toBeNull()
  })
  it('returns null for a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'))
    dirs.push(dir)
    process.env.SETU_MEDIA_DIR = dir
    expect(loadManifest('nope')).toBeNull()
  })
  it('returns null for corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'))
    dirs.push(dir)
    const md = join(dir, 'media', 'bad')
    mkdirSync(md, { recursive: true })
    writeFileSync(join(md, 'manifest.json'), '{ not json')
    process.env.SETU_MEDIA_DIR = dir
    expect(loadManifest('bad')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/site test media-manifest`
Expected: FAIL — cannot find `../src/lib/media-manifest`.

- [ ] **Step 3: Implement**

`apps/site/src/lib/media-manifest.ts`:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaManifest } from '@setu/core'

/** Extract the media id from a root-relative upload src `/uploads/media/<id>/...`;
 *  null for external/absolute or non-upload srcs (they have no manifest). */
export function manifestIdFromSrc(src: string): string | null {
  const m = /^\/uploads\/media\/([^/]+)\//.exec(src)
  return m ? m[1]! : null
}

/** Read + parse media/<id>/manifest.json from SETU_MEDIA_DIR at build time; null when the
 *  env is unset, the file is absent/unreadable, or the JSON is malformed. Never throws. */
export function loadManifest(id: string): MediaManifest | null {
  const dir = process.env.SETU_MEDIA_DIR
  if (!dir) return null
  try {
    const raw = readFileSync(join(dir, 'media', id, 'manifest.json'), 'utf8')
    const m = JSON.parse(raw) as MediaManifest
    if (!m || !Array.isArray(m.variants) || !m.original) return null
    return m
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @setu/site test media-manifest`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/media-manifest.ts apps/site/test/media-manifest.test.ts
git commit -m "feat(site): build-time manifest discovery + load (never-throws)"
```

---

### Task 3: Wire `Image.astro` + dev config + the end-to-end render test

**Files:**
- Modify: `apps/site/src/components/Image.astro`
- Modify: `apps/site/test/render.test.ts`
- Modify: `package.json` (root — add `SETU_MEDIA_DIR` to the site dev command)

**Interfaces:**
- Consumes: `imageMarkup` (Task 1), `manifestIdFromSrc`/`loadManifest` (Task 2).

- [ ] **Step 1: Update the render test to set up a manifest + build with `SETU_MEDIA_DIR`**

In `apps/site/test/render.test.ts`:
- Extend the `node:fs`/`node:os` imports at the top to include what the setup needs (merge with the existing imports; the file already imports `readFileSync`, `readdirSync`, `join`, `execSync`):
```ts
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
```
- Replace the existing `beforeAll(() => { execSync('pnpm build', …); html = page('post/kitchen-sink') })` with:
```ts
let mediaDir = ''
beforeAll(() => {
  mediaDir = mkdtempSync(join(tmpdir(), 'site-media-'))
  const md = join(mediaDir, 'media', 'test')
  mkdirSync(md, { recursive: true })
  writeFileSync(
    join(md, 'manifest.json'),
    JSON.stringify({
      id: 'test',
      format: 'webp',
      original: { key: 'media/test/original.png', width: 1000, height: 600, format: 'png' },
      variants: [
        { width: 400, height: 240, key: 'media/test/w400.webp', contentType: 'image/webp' },
        { width: 800, height: 480, key: 'media/test/w800.webp', contentType: 'image/webp' },
        { width: 1000, height: 600, key: 'media/test/w1000.webp', contentType: 'image/webp' },
      ],
    }),
  )
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit', env: { ...process.env, SETU_MEDIA_DIR: mediaDir } })
  html = page('post/kitchen-sink')
})
afterAll(() => {
  if (mediaDir) rmSync(mediaDir, { recursive: true, force: true })
})
```
- Replace the existing `describe('render pipeline — images', …)` block with:
```ts
describe('render pipeline — images', () => {
  it('renders an uploaded image responsively from its manifest', () => {
    // original src resolved against PUBLIC_SETU_MEDIA (default localhost:4444)
    expect(html).toContain('src="http://localhost:4444/uploads/media/test/original.png"')
    expect(html).toContain('http://localhost:4444/uploads/media/test/w400.webp 400w')
    expect(html).toContain('http://localhost:4444/uploads/media/test/w1000.webp 1000w')
    expect(html).toContain('width="1000"')
    expect(html).toContain('height="600"')
    expect(html).toContain('alt="A test cat"')
    expect(html).toContain('loading="lazy"')
  })
  it('leaves an absolute external image a plain img (no manifest lookup)', () => {
    expect(html).toContain('src="https://example.com/photo.png"')
    expect(html).toContain('alt="External photo"')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/site test render`
Expected: FAIL — `Image.astro` doesn't read the manifest yet, so no `srcset`/`width`/`height` is emitted; the `w400.webp 400w` and `width="1000"` assertions fail.

- [ ] **Step 3: Wire `Image.astro`**

Replace `apps/site/src/components/Image.astro` with:
```astro
---
// Render an image node responsively. With a variant manifest (#4b) → <img srcset sizes
// width height>; without one (external/non-image/manifest-less) → the plain #3 image.
// The manifest is read from SETU_MEDIA_DIR at build time; URLs resolve against PUBLIC_SETU_MEDIA.
import { manifestIdFromSrc, loadManifest } from '../lib/media-manifest'
import { imageMarkup } from '../lib/image-markup'

const { src = '', alt = '', title, sizes = '100vw' } = Astro.props
const base = (import.meta.env.PUBLIC_SETU_MEDIA ?? 'http://localhost:4444').replace(/\/+$/, '')
const resolveUrl = (s: string) => (!s || /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? `${base}${s}` : s)

const id = manifestIdFromSrc(src)
const manifest = id ? loadManifest(id) : null
const a = imageMarkup({ manifest, resolvedSrc: resolveUrl(src), alt, title, resolveUrl, sizes })
---
<img
  src={a.src}
  srcset={a.srcset}
  sizes={a.srcset ? a.sizes : undefined}
  width={a.width}
  height={a.height}
  alt={a.alt}
  title={a.title}
  loading="lazy"
  decoding="async"
/>
```

- [ ] **Step 4: Run the render test to verify it passes**

Run: `pnpm --filter @setu/site test render`
Expected: PASS — the `test` image now has the resolved `srcset` + `width`/`height`; the external image stays plain; the rest of the render suite stays green.

- [ ] **Step 5: Wire `SETU_MEDIA_DIR` into the dev script**

In the root `package.json` `"dev"` script, find the site segment:
```
SETU_CONTENT_DIR=$PWD/.content-sandbox/dev/content SETU_API_URL=http://localhost:4444 PUBLIC_SETU_MEDIA=http://localhost:4444 pnpm --filter @setu/site dev
```
and add `SETU_MEDIA_DIR=$PWD/.setu/uploads` to its env prefix:
```
SETU_CONTENT_DIR=$PWD/.content-sandbox/dev/content SETU_API_URL=http://localhost:4444 PUBLIC_SETU_MEDIA=http://localhost:4444 SETU_MEDIA_DIR=$PWD/.setu/uploads pnpm --filter @setu/site dev
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @setu/site typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components/Image.astro apps/site/test/render.test.ts package.json
git commit -m "feat(site): manifest-driven responsive <img srcset> in Image.astro"
```

---

## Final verification (after all tasks)

- [ ] Full suite + typecheck across the workspace:
  - `pnpm -r test`
  - `pnpm -r typecheck`
  - Expected: all green (site image-markup + media-manifest units + the render build e2e; nothing else affected).
- [ ] Manual smoke (optional): `pnpm dev`, upload an image via admin `/media`, insert it into a post, publish; view the page — the `<img>` has a `srcset` of `w<width>.webp` variants and intrinsic `width`/`height`.

## Notes for the executor

- **`SETU_MEDIA_DIR` is a build/server var** (not `PUBLIC_`) — read in `.astro` frontmatter (build context) only; it must never reach the client.
- **`loadManifest` must never throw** — every failure path returns `null` so the image degrades to the plain #3 `<img>`. Do not let a missing/corrupt manifest break the build.
- **Reuse the #3 resolver exactly** (`resolveUrl`) — don't invent a second resolution path; the original `src` and the variant URLs both go through it so the editor and site can't drift.
- **Node APIs** (`node:fs`, `node:os`, `node:path`, `process.env`) are available in the site's Vitest (Node env) and at Astro build — no extra config.
