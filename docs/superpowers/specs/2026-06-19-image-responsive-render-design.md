# Responsive image render — media slice #4c

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** Media/Images **#4c** — the visible payoff of #4. Makes the static site emit responsive
`<img srcset sizes width height>` from the variant **manifest** persisted by #4b, falling back to the
plain `<img>` shipped in #3 when no manifest exists. Zero per-render cost (the variants are static).

## Goal

`Image.astro` reads `media/<id>/manifest.json` (written by #4b) at build time and upgrades the plain
`<img>` to a responsive one — `srcset` of the variant ladder, `sizes`, and intrinsic `width`/`height`
(CLS-free). When there is no manifest (an external image, a gif, a non-image, or a generation failure),
it renders exactly the #3 plain `<img>`. No new content, no editor change — the render component just
gets smarter.

## The decisions this rests on (settled in brainstorm)

- **Manifest source = a build-time FS read of `${SETU_MEDIA_DIR}/media/<id>/manifest.json`.** This is
  the Node/local/VPS topology (the build and the uploaded files are on the same machine). The edge
  build reading manifests from R2/the CDN is a **deferred topology concern** — a small swap behind the
  `loadManifest` seam, not this slice.
- **`SETU_MEDIA_DIR` (FS path) is distinct from `PUBLIC_SETU_MEDIA` (URL origin).** The former is where
  the build *reads* manifests; the latter is the origin variant/original URLs *resolve* against (the #3
  mechanism, reused). In dev both point at the local API's upload dir / origin.
- **`sizes` defaults to `100vw`.** A safe generic for an unconstrained content image; the rich
  `{% image %}` block (#5) sets proper per-alignment `sizes` later. Overridable via a prop.
- **`src` fallback = the resolved original** (full size) for browsers that ignore `srcset`.
- **Graceful degradation is the rule:** any path without a usable manifest renders the #3 plain `<img>`
  — never a broken image, never a build failure.

## Verified before designing (standing rules)

- **Rule #1 (read source):** confirmed against the repo —
  - The shipped `apps/site/src/components/Image.astro` (#3): resolves a root-relative `/uploads/…` src
    against `import.meta.env.PUBLIC_SETU_MEDIA` (default `http://localhost:4444`), leaves absolute
    `http(s)://` srcs alone, emits `<img src alt title loading="lazy" decoding="async">`. This is the
    file #4c upgrades; the resolution logic is reused verbatim.
  - `@setu/core` exports `MediaManifest` (`{ id, format, original:{key,width,height,format},
    variants:[{width,height,key,contentType}] }`) — the build reads + parses this.
  - The site build runs on **Node** (`astro build`), so a build-time `node:fs` read is available;
    `process.env.SETU_MEDIA_DIR` is readable in `.astro` frontmatter (server/build context).
  - The render test `apps/site/test/render.test.ts` builds via `execSync('pnpm build')` and asserts
    against the kitchen-sink HTML; the image fixtures are `/uploads/media/test/original.png` (root-
    relative) + an external `https://example.com/photo.png`.
  - Site `dependencies` already include `@setu/core`; the dev script's site segment carries
    `SETU_CONTENT_DIR`, `SETU_API_URL`, `PUBLIC_SETU_MEDIA`.
- **Rule #2 (Cloudflare + cost):** the render reads a small JSON at **build** and emits **static**
  `<img srcset>` — **zero per-visitor cost**, no runtime image service. `SETU_MEDIA_DIR` is a
  server-only build var (not `PUBLIC_`), so it never reaches the client. On edge, the build still runs
  on Node (build-time) — only the *manifest source* changes (deferred), not this render.

## Architecture — three units

### 1. `apps/site/src/lib/media-manifest.ts` — manifest discovery + load (build-time)
```ts
import type { MediaManifest } from '@setu/core'

/** Extract the media id from a root-relative upload src `/uploads/media/<id>/original.<ext>`,
 *  else null (external/absolute or non-upload srcs have no manifest). */
export function manifestIdFromSrc(src: string): string | null

/** Read + parse media/<id>/manifest.json from SETU_MEDIA_DIR at build time; null when
 *  the env is unset, the file is absent, or it can't be parsed. Never throws. */
export function loadManifest(id: string): MediaManifest | null
```
- `manifestIdFromSrc`: matches `^/uploads/media/<id>/` → returns `<id>` (no slashes); anything else
  (absolute http(s), non-`/uploads/`, malformed) → null.
- `loadManifest`: `const dir = process.env.SETU_MEDIA_DIR; if (!dir) return null`; reads
  `join(dir, 'media', id, 'manifest.json')` with `readFileSync` inside a try/catch (missing file or
  bad JSON → null). A light shape guard (has `variants` array + `original`) before returning.

### 2. `apps/site/src/lib/image-markup.ts` — the pure render-attrs builder
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
  resolvedSrc: string                  // the already-resolved (absolute) original URL
  alt: string
  title?: string
  resolveUrl: (rootRelative: string) => string  // `/uploads/<key>` → absolute (the #3 resolver)
  sizes: string
}
export function imageMarkup(input: ImageMarkupInput): ImageAttrs
```
- **With a manifest** (and ≥1 variant): `src = resolvedSrc` (the original); `srcset =
  manifest.variants.map(v => \`${input.resolveUrl('/uploads/' + v.key)} ${v.width}w\`).join(', ')`;
  `sizes = input.sizes`; `width = manifest.original.width`; `height = manifest.original.height`;
  `alt`/`title` passed through.
- **Without a manifest** (null or empty variants): `{ src: resolvedSrc, alt, title }` — the #3 plain
  `<img>`. Pure + fully unit-testable (no fs, no Astro).

### 3. `apps/site/src/components/Image.astro` — the glue
```astro
---
import { manifestIdFromSrc, loadManifest } from '../lib/media-manifest'
import { imageMarkup } from '../lib/image-markup'
const { src = '', alt = '', title, sizes = '100vw' } = Astro.props
const base = (import.meta.env.PUBLIC_SETU_MEDIA ?? 'http://localhost:4444').replace(/\/+$/, '')
const resolveUrl = (s: string) => (!s || /^https?:\/\//i.test(s) ? s : s.startsWith('/') ? `${base}${s}` : s)
const resolvedSrc = resolveUrl(src)
const id = manifestIdFromSrc(src)
const manifest = id ? loadManifest(id) : null
const a = imageMarkup({ manifest, resolvedSrc, alt, title, resolveUrl, sizes })
---
<img src={a.src} srcset={a.srcset} sizes={a.srcset ? a.sizes : undefined}
     width={a.width} height={a.height} alt={a.alt} title={a.title}
     loading="lazy" decoding="async" />
```
(Astro drops attributes whose value is `undefined`, so the no-manifest path emits exactly the #3 markup
plus the harmless absence of srcset/sizes/width/height.)

### 4. Config
- Site gets **`SETU_MEDIA_DIR`** (the FS path to the upload dir — default unset → no manifests → plain
  `<img>`), added to the dev script's site segment as `SETU_MEDIA_DIR=$PWD/.setu/uploads` (the dir the
  api writes to).

## Data flow

```
content ![alt](/uploads/media/<id>/original.png)
  → Image.astro: resolveUrl(src) (origin prepend) ; id = manifestIdFromSrc(src)
  → loadManifest(id) reads <SETU_MEDIA_DIR>/media/<id>/manifest.json (build-time FS)
  → imageMarkup:
        manifest? → <img src=original srcset="…/w400.webp 400w, …" sizes="100vw" width height>
        none      → <img src=resolved alt>            (the #3 plain image)
```

## Error handling

- `loadManifest` **never throws** — unset env / missing file / unparseable JSON / wrong shape → `null` →
  plain `<img>`.
- A manifest with zero variants → treated as no-manifest (plain `<img>`).
- External/absolute srcs → `manifestIdFromSrc` returns null → plain `<img>` (no FS hit).
- `width`/`height` only emitted when a manifest supplies them (avoids asserting wrong intrinsic dims).

## Testing

- **`image-markup` (pure unit):** manifest with 3 variants → `srcset` has all three `"<url> <w>w"`
  entries (resolved against a stub `resolveUrl`), `sizes`, `width`/`height` from `original`, `src` =
  the original; null manifest → `{ src, alt }` only (no srcset); empty-variants manifest → plain.
- **`media-manifest` (Node):** `manifestIdFromSrc` extracts the id from `/uploads/media/<id>/original.png`
  and returns null for an absolute/external src and a non-`/uploads/` path; `loadManifest` reads a
  manifest written to a tmp `SETU_MEDIA_DIR` and returns `null` for a missing file / unset env /
  corrupt JSON (sets/restores `process.env.SETU_MEDIA_DIR`).
- **`apps/site/test/render.test.ts` (end-to-end build):** in `beforeAll`, write a `test`-id manifest
  (3 webp variants + original 1000×600) to a tmp dir and build with `SETU_MEDIA_DIR` set to it (env
  passed to `execSync`). The kitchen-sink `test` image now emits a `srcset` containing
  `…/uploads/media/test/w400.webp 400w` + `width="1000" height="600"`; the **external** image stays a
  plain `<img>` with no `srcset`. (Updates the #3 image assertions accordingly.)
- Full repo green + typecheck.

## Out of scope (later media slices — roadmap)

Per-alignment/width `sizes` + caption/lightbox (the rich `{% image %}` block, #5); focal/crop (#4d);
per-image quality/format override (#4e); queued/batch generation (#4f); the edge manifest source
(R2/CDN read at build — a swap behind `loadManifest`); the media-library registry/UI (#6); a
`<picture>`/multi-format render (we chose single-format in #4b).

## Success criteria

A built page renders an uploaded image as `<img srcset="…w400.webp 400w, …w800.webp 800w, …" sizes=
"100vw" width=… height=…>` (variants resolved against `PUBLIC_SETU_MEDIA`, intrinsic dims from the
manifest) when a manifest exists at `${SETU_MEDIA_DIR}/media/<id>/manifest.json`, and falls back to the
#3 plain `<img>` for external/non-image/manifest-less images — never a broken image or a build failure.
All tests green.
