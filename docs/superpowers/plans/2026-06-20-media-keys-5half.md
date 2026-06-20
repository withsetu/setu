# Human-readable media keys #5½ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and serve media at WordPress-style `/media/<YYYY>/<MM>/<slug>[-<width>w].<ext>` keys derived from the upload filename + date, replacing the opaque `/uploads/media/<uuid>/…` scheme.

**Architecture:** A pure, edge-safe key module (`media-key.ts`) computes `mediaKey = <yyyy>/<mm>/<slug>` and the original/variant/manifest storage keys from it. The api mints the key on upload (slug + UTC date + a `StoragePort.exists` collision loop) and serves `/media/*`; ingest derives variant + sidecar-manifest keys from the mediaKey; the site render derives the manifest from the content `src`. Clean break — the old `media/<uuid>/` scheme and `/uploads/` route are removed and the render-test fixtures rewritten.

**Tech Stack:** TypeScript, Hono (api), Vitest. `@setu/core` (edge-safe key + ingest). Astro (site render).

## Global Constraints

- **`mediaKey = <YYYY>/<MM>/<slug>`** (UTC year, zero-padded month, sanitized filename slug). Public URL prefix is **`/media/`** (the storage key has NO `media/` prefix).
- **Variant suffix = `-<width>w`** (e.g. `2026/06/my-cat-photo-800w.webp`). Original = `<mediaKey>.<ext>`. Manifest (sidecar) = `<mediaKey>.manifest.json`.
- **Clean break:** no old `media/<uuid>/…` keys, no `/uploads/` route, no dual-scheme. Rewrite the affected fixtures.
- **`mediaSlug`** is pure + edge-safe (no Node APIs); empty/exotic filename → `'file'`; collisions deduped with a `-2`, `-3`, … suffix on the slug (probe the **original** key via `StoragePort.exists`).
- **Helpers live in `@setu/core`** (edge-safe — covered by `tsconfig.edge.json`, no Node/DOM types) and are exported from the core barrel.
- **Render never throws:** `manifestKeyFromSrc`/`loadManifest` return null on external/non-media/missing → plain `<img>`.
- **Commit trailer on every commit:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run all commands from the worktree root; verify branch `worktree-media-keys` before any commit; never `git checkout/switch/reset/merge`.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/core/src/image/media-key.ts` | Create | pure `mediaSlug`/`mediaKeyOf`/`originalKey`/`variantKey`/`manifestKey` |
| `packages/core/src/index.ts` | Modify | export the new helpers |
| `packages/core/test/media-key.test.ts` | Create | unit tests for the helpers |
| `packages/core/src/image/ingest.ts` | Modify | `id`→`mediaKey`; derive variant/manifest keys |
| `packages/core/test/image-ingest.test.ts` | Modify | new key assertions |
| `apps/api/src/media.ts` | Modify | mint mediaKey + collision; serve `GET /media/*` |
| `apps/api/src/server.ts` | Modify | `SETU_MEDIA_PUBLIC_URL` default `…/media` |
| `apps/api/test/media-upload.test.ts`, `media-serve.test.ts`, `media-e2e.test.ts` | Modify | new keys/route |
| `apps/site/src/lib/media-manifest.ts` | Modify | `manifestKeyFromSrc` + `loadManifest(<key>.manifest.json)` |
| `apps/site/src/lib/image-markup.ts` | Modify | srcset under `/media/` |
| `apps/site/src/components/Image.astro` | Modify | rename the two calls |
| `apps/site/test/media-manifest.test.ts`, `image-markup.test.ts`, `render.test.ts` | Modify | new scheme |

---

### Task 1: Pure media-key helpers

**Files:**
- Create: `packages/core/src/image/media-key.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/media-key.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mediaSlug(filename: string): string`, `mediaKeyOf(yyyy: number, mm: number, slug: string): string`, `originalKey(mediaKey: string, ext: string): string`, `variantKey(mediaKey: string, width: number, ext: string): string`, `manifestKey(mediaKey: string): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/media-key.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mediaSlug, mediaKeyOf, originalKey, variantKey, manifestKey } from '../src/index'

describe('mediaSlug', () => {
  it('lowercases, strips the extension, and dash-joins words', () => {
    expect(mediaSlug('My Cat Photo.JPG')).toBe('my-cat-photo')
  })
  it('collapses punctuation/unicode and trims dashes', () => {
    expect(mediaSlug('  Héllo — Wörld!!.png')).toBe('hello-world')
  })
  it('falls back to "file" for an empty/exotic name', () => {
    expect(mediaSlug('©.png')).toBe('file')
    expect(mediaSlug('.gitignore')).toBe('file')
  })
  it('caps very long slugs at 60 chars (no trailing dash)', () => {
    const s = mediaSlug('a'.repeat(200) + '.jpg')
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('key assembly', () => {
  it('mediaKeyOf zero-pads the month', () => {
    expect(mediaKeyOf(2026, 6, 'my-cat-photo')).toBe('2026/06/my-cat-photo')
    expect(mediaKeyOf(2026, 12, 'x')).toBe('2026/12/x')
  })
  it('builds original/variant/manifest keys', () => {
    const k = '2026/06/my-cat-photo'
    expect(originalKey(k, 'jpg')).toBe('2026/06/my-cat-photo.jpg')
    expect(variantKey(k, 800, 'webp')).toBe('2026/06/my-cat-photo-800w.webp')
    expect(manifestKey(k)).toBe('2026/06/my-cat-photo.manifest.json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test media-key`
Expected: FAIL — `media-key` module / exports do not exist.

- [ ] **Step 3: Implement the helpers**

Create `packages/core/src/image/media-key.ts`:
```ts
// Pure, edge-safe media-key helpers. No Node/DOM APIs (compiles under tsconfig.edge.json).
const MAX_SLUG = 60

/** Sanitize an upload filename into a URL-safe slug (no extension): NFKD-fold, lowercase ASCII,
 *  runs of non-alphanumerics → '-', trimmed/collapsed, capped at 60 chars. Empty → 'file'. */
export function mediaSlug(filename: string): string {
  const base = filename.replace(/\.[^./\\]*$/, '') // strip a trailing extension
  const slug = base
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
  return slug || 'file'
}

/** `${yyyy}/${mm}/${slug}` with a zero-padded month. */
export function mediaKeyOf(yyyy: number, mm: number, slug: string): string {
  return `${yyyy}/${String(mm).padStart(2, '0')}/${slug}`
}

/** Storage key of the original: `${mediaKey}.${ext}`. */
export function originalKey(mediaKey: string, ext: string): string {
  return `${mediaKey}.${ext}`
}

/** Storage key of a width variant: `${mediaKey}-${width}w.${ext}`. */
export function variantKey(mediaKey: string, width: number, ext: string): string {
  return `${mediaKey}-${width}w.${ext}`
}

/** Storage key of the sidecar manifest: `${mediaKey}.manifest.json`. */
export function manifestKey(mediaKey: string): string {
  return `${mediaKey}.manifest.json`
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/core/src/index.ts`, after the existing `export { ingestImage } …` block (around line 29), add:
```ts
export { mediaSlug, mediaKeyOf, originalKey, variantKey, manifestKey } from './image/media-key'
```

- [ ] **Step 5: Run tests + edge typecheck**

Run: `pnpm --filter @setu/core test media-key && pnpm --filter @setu/core typecheck`
Expected: tests PASS; typecheck (incl. `tsconfig.edge.json`) clean (proves the helpers are edge-safe).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/image/media-key.ts packages/core/src/index.ts packages/core/test/media-key.test.ts
git commit -m "feat(core): pure media-key helpers (slug + date keys) (#5half)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Ingest derives keys from the mediaKey

**Files:**
- Modify: `packages/core/src/image/ingest.ts`
- Test: `packages/core/test/image-ingest.test.ts` (+ `media-ingest-e2e.test.ts` if it asserts keys)

**Interfaces:**
- Consumes: `variantKey`, `manifestKey` (Task 1); existing `extensionFor`/`contentTypeFor`.
- Produces: `IngestInput` now has `mediaKey: string` (replacing `id`); `MediaManifest.id === mediaKey`; variant keys `<mediaKey>-<w>w.<ext>`; manifest at `<mediaKey>.manifest.json`.

- [ ] **Step 1: Update the failing test**

In `packages/core/test/image-ingest.test.ts`, change the `ingestImage` call + assertions to the mediaKey scheme:
```ts
    const manifest = await ingestImage(
      { image: stubImage(1000, 500), storage: port },
      { mediaKey: '2026/06/cat', bytes: new Uint8Array([1]), originalKey: '2026/06/cat.png', format: 'webp', widths: [400, 800, 1200, 1600] },
    )
    expect(manifest.id).toBe('2026/06/cat')
    expect(manifest.variants.map((v) => v.width)).toEqual([400, 800, 1000])
    expect(manifest.variants.map((v) => v.key)).toEqual([
      '2026/06/cat-400w.webp',
      '2026/06/cat-800w.webp',
      '2026/06/cat-1000w.webp',
    ])
    // manifest persisted at the sidecar key
    expect(map.has('2026/06/cat.manifest.json')).toBe(true)
```
(Keep the rest of the test; adjust any other `media/abc/…` / `id: 'abc'` references in this file to the `2026/06/cat` scheme. Read the whole file and update every old-scheme assertion.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @setu/core test image-ingest`
Expected: FAIL — `IngestInput` still requires `id`; keys are still `media/<id>/w<w>.<ext>`.

- [ ] **Step 3: Update ingest.ts**

In `packages/core/src/image/ingest.ts`:
1. Add the import: `import { variantKey, manifestKey } from './media-key'`
2. Change `IngestInput`: replace `id: string` with `mediaKey: string`, and update the `originalKey` comment example to `2026/06/cat.png`.
3. In `ingestImage`, destructure `mediaKey` instead of `id`, and build keys from it:
```ts
  const { image, storage } = deps
  const { mediaKey, bytes, originalKey, format, widths } = input
  // …meta / ext / contentType / effective / specs / variants unchanged…
  const manifestVariants: ManifestVariant[] = []
  for (const v of variants) {
    const key = variantKey(mediaKey, v.width, ext)
    await storage.put(key, v.body, { contentType })
    manifestVariants.push({ width: v.width, height: v.height, key, contentType })
  }
  const manifest: MediaManifest = {
    id: mediaKey,
    format,
    original: { key: originalKey, width: meta.width, height: meta.height, format: meta.format },
    variants: manifestVariants,
  }
  await storage.put(manifestKey(mediaKey), new TextEncoder().encode(JSON.stringify(manifest)), {
    contentType: 'application/json',
  })
  return manifest
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @setu/core test image-ingest media-ingest-e2e`
Expected: PASS. If `media-ingest-e2e.test.ts` asserts old `media/<id>/…` keys, update those to the new scheme (read it; it likely passes `mediaKey`/asserts `…-<w>w.<ext>` now). Then `pnpm --filter @setu/core typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/image/ingest.ts packages/core/test/image-ingest.test.ts packages/core/test/media-ingest-e2e.test.ts
git commit -m "feat(core): ingest derives variant/manifest keys from mediaKey (#5half)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: API mints human keys + serves `/media/*`

**Files:**
- Modify: `apps/api/src/media.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/media-upload.test.ts`, `media-serve.test.ts`, `media-e2e.test.ts`

**Interfaces:**
- Consumes: `mediaSlug`, `mediaKeyOf`, `originalKey` (Task 1); `ingestImage` with `mediaKey` (Task 2).
- Produces: upload response `{ id: mediaKey, key: '<mediaKey>.<ext>', url: '…/media/<mediaKey>.<ext>', … }`; route `GET /media/*`.

- [ ] **Step 1: Update the failing tests**

Read `apps/api/test/media-upload.test.ts`, `media-serve.test.ts`, `media-e2e.test.ts` and update them to the new scheme. The key new assertions:
- Uploading a file named e.g. `Cat.png` (image/png) returns `id` matching `^\d{4}/\d{2}/cat$`, `key` = `<id>.png`, `url` ending `/media/<id>.png`. (Use a regex on `id` since the year/month are "now".)
- A **second** upload of `Cat.png` (with the first already stored) returns `id` = `<yyyy>/<mm>/cat-2` — drive the collision by uploading twice against the same in-memory storage, or by stubbing `storage.exists` to return true once.
- `GET /media/<key>` (e.g. the returned `key`) serves the stored bytes; `GET /media/../etc` (a `..` segment) returns 404 (traversal guard).
Write the precise assertions matching each test's existing structure (read them first). Keep the auth/size/type tests intact.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @setu/api test media-upload media-serve media-e2e`
Expected: FAIL — responses still use `media/<uuid>/original.<ext>`; route is `/uploads/*`.

- [ ] **Step 3: Update media.ts — mint the key**

In `apps/api/src/media.ts`, add the import `import { mediaSlug, mediaKeyOf, originalKey } from '@setu/core'`, and replace the id/key lines (currently `const id = crypto.randomUUID(); const key = \`media/${id}/original.${ext}\``) with:
```ts
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = now.getUTCMonth() + 1
    const slug = mediaSlug(file.name)
    let mediaKey = mediaKeyOf(yyyy, mm, slug)
    for (let n = 2; await storage.exists(originalKey(mediaKey, ext)); n += 1) {
      mediaKey = mediaKeyOf(yyyy, mm, `${slug}-${n}`)
    }
    const key = originalKey(mediaKey, ext)
```
Update the `ingestImage` input from `{ id, … }` to `{ mediaKey, bytes, originalKey: key, format: imageConfig.format, widths: imageConfig.widths }`, the `catch` log from `${id}` to `${mediaKey}`, and the response `id` field from `id` to `mediaKey`.

- [ ] **Step 4: Update media.ts — serve `/media/*`**

Replace the `app.get('/uploads/*', …)` handler with:
```ts
  app.get('/media/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/media/'.length))
    if (key.split('/').some((seg) => seg === '..' || seg === '')) return c.json({ error: 'not found' }, 404)
    const obj = await storage.get(key)
    if (!obj) return c.json({ error: 'not found' }, 404)
    const headers: Record<string, string> = { 'Content-Type': obj.contentType }
    if (!obj.contentType.startsWith('image/')) headers['Content-Disposition'] = 'attachment'
    return new Response(obj.body, { status: 200, headers })
  })
```

- [ ] **Step 5: Update server.ts default**

In `apps/api/src/server.ts`, change the `mediaPublicUrl` default from `…/uploads` to `…/media`:
```ts
const mediaPublicUrl = process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/media`
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @setu/api test && pnpm --filter @setu/api typecheck`
Expected: PASS (all api tests) + clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/media.ts apps/api/src/server.ts apps/api/test/media-upload.test.ts apps/api/test/media-serve.test.ts apps/api/test/media-e2e.test.ts
git commit -m "feat(api): mint /media/YYYY/MM/slug keys + collision; serve /media/* (#5half)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Site render derives the manifest from the `src`

**Files:**
- Modify: `apps/site/src/lib/media-manifest.ts`, `apps/site/src/lib/image-markup.ts`, `apps/site/src/components/Image.astro`
- Test: `apps/site/test/media-manifest.test.ts`, `image-markup.test.ts`, `render.test.ts`

**Interfaces:**
- Consumes: the new key scheme + `MediaManifest` (variant `key` is the full storage key).
- Produces: `manifestKeyFromSrc(src): string | null`, `loadManifest(mediaKey): MediaManifest | null`; srcset URLs under `/media/`.

- [ ] **Step 1: Update the failing unit tests**

In `apps/site/test/media-manifest.test.ts`: rename `manifestIdFromSrc`→`manifestKeyFromSrc`; assert `manifestKeyFromSrc('/media/2026/06/my-cat-photo.jpg')` → `'2026/06/my-cat-photo'`, external `https://…` and non-`/media/` → null; `loadManifest('2026/06/cat')` reads a manifest written to `${tmp}/2026/06/cat.manifest.json` (set `SETU_MEDIA_DIR=tmp`), and returns null for a missing one / unset env.
In `apps/site/test/image-markup.test.ts`: the srcset entries now resolve `/media/<v.key>` (e.g. `…/media/2026/06/cat-800w.webp 800w`) — update the expected strings (the stub `resolveUrl` and the variant `key` values).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @setu/site test media-manifest image-markup`
Expected: FAIL — `manifestKeyFromSrc` doesn't exist; srcset still uses `/uploads/`.

- [ ] **Step 3: Update media-manifest.ts**

Replace `apps/site/src/lib/media-manifest.ts` with:
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaManifest } from '@setu/core'

/** mediaKey for a root-relative `/media/<y>/<m>/<slug>.<ext>` src (strip prefix + extension);
 *  null for external/absolute or non-`/media/` srcs (they have no manifest). */
export function manifestKeyFromSrc(src: string): string | null {
  if (!src.startsWith('/media/')) return null
  const rest = src.slice('/media/'.length)
  const key = rest.replace(/\.[^./]*$/, '') // strip the extension
  return key.length > 0 ? key : null
}

/** Read + parse `${SETU_MEDIA_DIR}/<mediaKey>.manifest.json` at build time; null when the env is
 *  unset, the file is absent/unreadable, or the JSON is malformed. Never throws. */
export function loadManifest(mediaKey: string): MediaManifest | null {
  const dir = process.env.SETU_MEDIA_DIR
  if (!dir) return null
  try {
    const raw = readFileSync(join(dir, `${mediaKey}.manifest.json`), 'utf8')
    const m = JSON.parse(raw) as MediaManifest
    if (!m || !Array.isArray(m.variants) || !m.original) return null
    return m
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Update image-markup.ts + Image.astro**

In `apps/site/src/lib/image-markup.ts`, change the srcset builder prefix from `/uploads/` to `/media/`:
```ts
  const srcset = manifest.variants.map((v) => `${resolveUrl(`/media/${v.key}`)} ${v.width}w`).join(', ')
```
In `apps/site/src/components/Image.astro`, update the import + calls: `import { manifestKeyFromSrc, loadManifest } from '../lib/media-manifest'`; `const key = manifestKeyFromSrc(src); const manifest = key ? loadManifest(key) : null`. (The `resolveUrl` origin-prepend is unchanged — it already handles any root-relative `/…` path.)

- [ ] **Step 5: Rewrite the render-test fixtures**

In `apps/site/test/render.test.ts`:
1. In `beforeAll`, write the manifest to the **new sidecar path** and new variant keys. Replace the `media/test/manifest.json` write with `2026/06/test-cat.manifest.json`:
```ts
  const md = join(mediaDir, '2026', '06')
  mkdirSync(md, { recursive: true })
  writeFileSync(
    join(md, 'test-cat.manifest.json'),
    JSON.stringify({
      id: '2026/06/test-cat', format: 'webp',
      original: { key: '2026/06/test-cat.jpg', width: 1000, height: 600, format: 'jpeg' },
      variants: [
        { width: 400, height: 240, key: '2026/06/test-cat-400w.webp', contentType: 'image/webp' },
        { width: 800, height: 480, key: '2026/06/test-cat-800w.webp', contentType: 'image/webp' },
        { width: 1000, height: 600, key: '2026/06/test-cat-1000w.webp', contentType: 'image/webp' },
      ],
    }),
  )
```
2. Update the image assertions in the `render pipeline — images` and `{% image %} figure block` describes: the resolved original is now `http://localhost:4444/media/2026/06/test-cat.jpg`; srcset entries `…/media/2026/06/test-cat-400w.webp 400w` and `…-1000w.webp 1000w`; `sizes`/`width`/`height` unchanged.

- [ ] **Step 6: Rewrite the content fixture**

In `content/post/en/kitchen-sink.mdoc`, change the two image lines from the old scheme to the new:
- inline: `![A test cat](/media/2026/06/test-cat.jpg)`
- block: `{% image src="/media/2026/06/test-cat.jpg" alt="A wide test cat" caption="A caption with detail" align="wide" /%}`
(The external `https://example.com/photo.png` line stays.)

- [ ] **Step 7: Run the site tests**

Run: `pnpm --filter @setu/site test`
Expected: PASS — `media-manifest`, `image-markup`, and the full `render` build (figure + inline image now resolve `/media/2026/06/test-cat…`); the external-image plain-`<img>` assertion stays green.

- [ ] **Step 8: Typecheck the site**

Run: `pnpm --filter @setu/site typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/site/src/lib/media-manifest.ts apps/site/src/lib/image-markup.ts apps/site/src/components/Image.astro apps/site/test/media-manifest.test.ts apps/site/test/image-markup.test.ts apps/site/test/render.test.ts content/post/en/kitchen-sink.mdoc
git commit -m "feat(site): derive manifest from /media/ src; rewrite fixtures (#5half)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Whole-slice verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm -r test`
Expected: all packages green.

- [ ] **Step 2: Full typecheck**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 3: No `/uploads/` or `media/<uuid>` remnants**

Run: `grep -rn "/uploads/\|media/\${" apps packages --include=*.ts --include=*.astro --include=*.mjs | grep -v node_modules | grep -v "\.setu/uploads"`
Expected: no production matches (the only `uploads` left is the FS dir name `.setu/uploads` in the dev script env, which is fine — it's the local storage directory, not a URL path).

- [ ] **Step 4: Confirm clean tree**

Run: `git status --short`
Expected: clean.

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- `mediaKey`/slug/key helpers (spec unit 1) → Task 1. ✅
- mint + collision + `/media/*` serve (spec units 2, 3) → Task 3. ✅
- ingest variant/manifest keys (spec unit 4) → Task 2. ✅
- render lookup from src + srcset prefix + Image.astro (spec units 5, 6, 7) → Task 4. ✅
- clean break / fixtures rewritten (spec decision) → Task 4 Steps 5–6 + Task 5 Step 3 grep. ✅
- collisions / UTC / applies-to-all-media (spec decisions) → Task 3 Step 3. ✅
- public/private + registry are out of scope → no task builds them. ✅

**2. Placeholder scan:** none — concrete code/commands. Test-update steps name the exact new expected values; "read the file" appears only where the implementer must apply the named new-scheme values across an existing test's structure.

**3. Type consistency:** `mediaKey` (string) and the helper signatures (`mediaSlug`/`mediaKeyOf`/`originalKey`/`variantKey`/`manifestKey`) match across Task 1 (defs), Task 2 (ingest `IngestInput.mediaKey`, `variantKey`/`manifestKey`), Task 3 (api `mediaKeyOf`/`originalKey`), and Task 4 (`manifestKeyFromSrc`/`loadManifest`). Variant key form `<mediaKey>-<width>w.<ext>` and manifest `<mediaKey>.manifest.json` are identical in Task 1, Task 2, and Task 4's fixture.
