# Media upload service — media slice #2

**Date:** 2026-06-19
**Status:** approved (owner — design settled in brainstorm; trust-as-approval per working style)
**Sub-project:** Media/Images **#2** (see `docs/roadmap.md` → Media). Builds directly on the shipped
`StoragePort` foundation (#1). The first *visible* media win: drop a file → get a link.

## Goal

An **auth-gated upload service** on the Hono API: `POST` a file → it lands in `StoragePort` → you get
back a URL. Plus the dev/Node path that **serves the bytes back**, plus a **minimal admin upload
control** so the slice is actually demonstrable. This is the media library's generic *storage
backbone* — it stores and links arbitrary asset bytes (images, PDFs, docs, archives, audio, video),
not just images. The image-specific layer (variants/srcset/focal) is a later port (#4) that simply
inspects the content-type and skips non-images.

## Scope — what this slice is / isn't

**Is:**
- The upload endpoint (`POST /media`) on `apps/api`.
- A **real auth seam** (today dev-stubbed to the local owner) gating the endpoint.
- The dev/Node serving path (`GET /uploads/*`) so returned URLs load immediately.
- A **minimal admin upload control** on the existing `/media` route placeholder (pick file → upload →
  show the link + preview), so the win is visible.

**Isn't** (later media sub-projects, per the roadmap):
- No media-library **DB record / metadata persistence** (#5). We store bytes and return a link;
  nothing else is persisted this slice.
- No image **variants / resizing / srcset / focal point** (#4 — the `ImagePort`).
- No editor **image block** + round-trip (#3).
- No **`@setu/storage-s3`** adapter / presigned direct-upload (#6).
- No **real login/JWT/session** — only the seam it slots into (the RBAC/auth arc).
- No **SVG** support (XSS vector — needs sanitization; its own later item).
- No deep **magic-byte sniffing** (allowlist + size cap + attachment-disposition cover the real
  footguns for now).

## Verified before designing (standing rules)

- **Rule #1 (read source / check docs):** confirmed against the repo —
  - `apps/api/src/server.ts` mounts Hono factories via `app.route('/', createX())`, runs on
    `@hono/node-server` (Node, **not** Cloudflare), port `SETU_API_PORT` (default 4444), repo dir
    `SETU_REPO_DIR`. CORS is open (`app.use('*', cors())`); a global `.onError()` returns
    `{ error }` (500).
  - **No auth exists anywhere today.** `apps/admin/src/auth/actor.tsx` hardcodes
    `{ id: 'local', role: 'owner' }`. The RBAC vocabulary already exists in `@setu/core`:
    `createAuthz(matrix).can(actor, action)` (`packages/core/src/authz/authz.ts`), `DEFAULT_ROLES`
    (`default-roles.ts`), `Actor`/`Action`/`Role` (`types.ts`). `Action` already includes
    `content.create` — **no change to the authz vocabulary is needed**.
  - `StoragePort` (`packages/core/src/storage/storage-port.ts`) + `createLocalStorage({ dir, baseUrl })`
    (`packages/storage-local/src/index.ts`) are shipped and currently **unused**. `url(key)` returns
    `` `${baseUrl}/${key}` `` (so an absolute `baseUrl` yields an absolute, loadable URL).
  - Admin → API today: fetch-based ports keyed off `import.meta.env.VITE_SETU_API`
    (`http://localhost:4444` in dev, set by the root dev script).
  - Multipart parsing: `@hono/node-server` exposes web-standard `Request`, so
    `await c.req.formData()` works (no extra dep).
- **Rule #2 (Cloudflare + cost):**
  - **Size cap** (default 25 MB) + **content-type allowlist** prevent a disk-fill / abuse footgun.
  - The upload service is **admin-side**, not per-visitor — no per-render cost.
  - The `GET /uploads/*` serving route is the **Node/dev** path. On Cloudflare later, `baseUrl` points
    at the CDN/R2 and this route isn't used — same `StoragePort` contract, different serving origin.
  - SVG/HTML/JS/CSS blocked + non-image types served `Content-Disposition: attachment` → no stored-XSS
    from an uploaded asset rendered inline on our origin.

## Architecture — four units

### 1. Auth seam (`apps/api/src/auth/`)
A pluggable request→actor resolver, so real auth drops in later with **zero route changes**.

```ts
// apps/api/src/auth/resolve-actor.ts
import type { Actor } from '@setu/core'
/** Resolve the acting user for a request, or null if unauthenticated. */
export type ResolveActor = (req: Request) => Actor | null | Promise<Actor | null>

/** Dev resolver — the single local owner the admin already assumes. Real JWT/session
 *  swaps this one function out later; the middleware + routes don't change. */
export const resolveLocalOwner: ResolveActor = () => ({ id: 'local', role: 'owner' })
```

```ts
// apps/api/src/auth/middleware.ts
import { createMiddleware } from 'hono/factory'
import type { ResolveActor } from './resolve-actor'
import type { Actor } from '@setu/core'

/** Sets c.get('actor'); 401 when the resolver returns null. */
export function authMiddleware(resolveActor: ResolveActor) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    const actor = await resolveActor(c.req.raw)
    if (!actor) return c.json({ error: 'unauthenticated' }, 401)
    c.set('actor', actor)
    await next()
  })
}
```

Authorization uses core's existing matrix — the route checks `can(actor, 'content.create')` (reusing
an existing action; a dedicated `media.upload` action is a trivial later split):

```ts
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
const authz = createAuthz(DEFAULT_ROLES)
// in the route: if (!authz.can(c.get('actor'), 'content.create')) return c.json({ error:'forbidden' }, 403)
```

### 2. Upload service (`apps/api/src/media.ts`)
A Hono factory, mounted in `server.ts`:

```ts
export interface UploadLimits {
  maxBytes: number              // default 25 * 1024 * 1024
  allowedContentTypes: Set<string>  // default ALLOWED (below)
}
export interface UploadApiOptions {
  storage: StoragePort
  resolveActor: ResolveActor
  limits?: Partial<UploadLimits>
}
export function createUploadApi(opts: UploadApiOptions): Hono
```

**`POST /media` flow:**
1. `authMiddleware(resolveActor)` → 401 if no actor.
2. `authz.can(actor, 'content.create')` → 403 if not allowed.
3. `const form = await c.req.formData(); const file = form.get('file')` — must be a `File`/`Blob`;
   else **400** (`{ error: 'no file' }`).
4. **Validate:** `file.size > maxBytes` → **413**; `file.type` not in `allowedContentTypes` → **415**.
5. **Key:** `id = crypto.randomUUID()`; `ext = extensionFor(file.type)` (from the *content-type*, not
   the filename); `key = \`media/${id}/original.${ext}\``. The folder-per-id is deliberate — #4's
   variants (`card.webp`, …) become siblings under the same id.
6. **Store:** `await storage.put(key, new Uint8Array(await file.arrayBuffer()), { contentType: file.type })`.
7. **Respond 201:** `{ id, key, url: storage.url(key), contentType: file.type, size: file.size,
   filename: file.name }`. (`filename` is echoed, **not** persisted — #5's library persists metadata.)

**Allowlist (default `ALLOWED`):**
- Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`
- Documents: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  (docx), `…spreadsheetml.sheet` (xlsx), `…presentationml.presentation` (pptx), `text/plain`,
  `text/csv`, `text/markdown`
- Archives: `application/zip`
- Audio: `audio/mpeg`, `audio/wav`
- Video: `video/mp4`, `video/webm`
- **Blocked by default** (not on the list → 415): `image/svg+xml`, `text/html`, JS/CSS, executables,
  everything else.

**`extensionFor(contentType)`** — a small explicit content-type→extension map (the allowlist's inverse;
e.g. `image/jpeg→jpg`, `application/pdf→pdf`, `text/markdown→md`). A type with no mapping is, by
construction, not allowed — so this never falls through for an accepted upload.

### 3. Serving the bytes (`apps/api`, dev/Node path)
`GET /uploads/*` in the same factory (or a sibling): take the wildcard as the storage key,
`const obj = await storage.get(key)` → **404** if null; else stream `obj.body` with
`Content-Type: obj.contentType`. **Disposition:** `inline` for `image/*`, **`attachment`** for every
other type (the stored-XSS guard). The storage `baseUrl` is configured to
`http://localhost:<port>/uploads`, so `storage.url(key)` returns an absolute URL this route serves.

### 4. Config + wiring (`apps/api/src/server.ts`)
- `SETU_MEDIA_DIR` (default `<repoDir>/.setu/uploads`) — gitignored; created on first write by
  `storage-local`.
- `SETU_MEDIA_PUBLIC_URL` (default `http://localhost:<port>/uploads`).
- Wire: `const storage = createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl });`
  `app.route('/', createUploadApi({ storage, resolveActor: resolveLocalOwner }))`.
- Add `.setu/` to `.gitignore`.

### 5. Minimal admin control (`apps/admin`)
- A thin client (`apps/admin/src/media/upload-client.ts`):
  ```ts
  export async function uploadFile(apiBase: string, file: File): Promise<UploadResult> {
    const body = new FormData(); body.append('file', file)
    const res = await fetch(`${apiBase}/media`, { method: 'POST', body })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `upload failed (${res.status})`)
    return res.json()
  }
  ```
- The existing `/media` route placeholder becomes a bare uploader: a file input → `uploadFile` → on
  success render the returned `url` as a link and, if `contentType` starts with `image/`, an `<img>`
  preview; on error show the message. **No grid, no delete, no persistence** — that's #5. Reads the
  API base from `import.meta.env.VITE_SETU_API` (same pattern as the git port).

## Data flow

```
admin /media (file input) ──FormData──▶ POST /media (apps/api)
   authMiddleware(resolveLocalOwner) → 401? · authz.can(actor,'content.create') → 403?
   validate(size,type) → 413/415 · key=media/<uuid>/original.<ext>
   storage.put(key, bytes, {contentType}) ──▶ storage-local → <dir>/media/<uuid>/original.<ext> (+ .meta)
   201 { id, key, url, contentType, size, filename }
admin renders url ── GET /uploads/media/<uuid>/original.<ext> ──▶ storage.get(key) → stream bytes
   (image/* → inline · else → Content-Disposition: attachment)
```

## Error handling

- **401** unauthenticated (resolver → null). **403** actor lacks `content.create`.
- **400** no file / not a Blob / malformed multipart. **413** over `maxBytes`. **415** content-type
  not allowed.
- **404** `GET /uploads/*` for an absent key.
- Storage / fs errors propagate to the global `.onError()` → **500** (fail loud, never swallowed).

## Testing

- **`createUploadApi` (unit, inline in-memory `StoragePort` fake)** — exercises every branch via
  `app.request(...)`: happy path (201; object stored at `media/<uuid>/original.<ext>`; response `url`
  is absolute and contains the key); **401** (resolver → null); **403** (resolver → a `viewer`);
  **400** (no file field); **413** (size over a tiny configured `maxBytes`); **415** (a
  `text/html`/`image/svg+xml` file).
- **`GET /uploads/*` round-trip** — `put` via the service, then fetch the returned `url`'s path: bytes
  + content-type intact; `image/*` → `inline`, a non-image → `attachment`; absent key → 404.
- **End-to-end with the real `storage-local`** — one test wiring `createLocalStorage({ dir:<tmp>,
  baseUrl })` through `createUploadApi`: upload → bytes land on disk at the expected key (+ `.meta`),
  and the serving route reads them back. Proves the real adapter, not just the fake.
- **admin** — `uploadFile` posts FormData to `${apiBase}/media` and returns the parsed result; throws
  with the server `error` message on a non-OK status (fetch mocked).
- **Full repo green + typecheck** (incl. core's edge guard — this slice touches only `apps/api` and
  `apps/admin`, not `@setu/core`, so the edge surface is unchanged).

## Out of scope (later media slices — roadmap)

Media-library DB record + metadata (#5); image variants/srcset/focal/quality (#4, the `ImagePort`);
editor image block + round-trip (#3); `@setu/storage-s3` + presigned direct-upload (#6); real
login/JWT/session (the RBAC/auth arc); SVG (needs sanitization); deep magic-byte content sniffing;
draft→published asset sync; delete/replace UI; a dedicated `media.upload` authz action.

## Success criteria

An authenticated owner can `POST` a file (image **or** document/archive/audio/video within the
allowlist) to `POST /media` and receive a loadable URL; the bytes serve back from `GET /uploads/*`
(images inline, other types as a download); a viewer is **403**, an oversize/blocked-type upload is
**413/415**, and an unauthenticated request is **401** — all enforced through a real auth seam that
real login slots into without touching the routes. The `/media` admin page demonstrates it end-to-end.
All tests green.
