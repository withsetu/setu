# Media Upload Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An auth-gated upload endpoint on the Hono API that stores an uploaded file in `StoragePort` and returns a loadable URL, plus the dev serving path and a minimal admin upload control.

**Architecture:** A pluggable request→`Actor` auth seam (dev-stubbed to the local owner) gates a `POST /media` route that parses multipart, validates (size + content-type allowlist), stores bytes via `StoragePort` under `media/<uuid>/original.<ext>`, and returns `{ id, key, url, contentType, size, filename }`. A sibling `GET /uploads/*` route streams the bytes back (images inline, other types as downloads). The admin `/media` page gets a thin uploader that calls the endpoint and shows the link + preview.

**Tech Stack:** Hono 4.12 on `@hono/node-server` (Node), `@setu/core` (StoragePort + authz), `@setu/storage-local`, Vitest, React 18 + React Router (admin).

## Global Constraints

- **The `StoragePort` interface + authz live in `@setu/core`; do NOT modify `@setu/core` in this slice.** Consume its existing exports only: `StoragePort`, `StoredObject`, `Actor`, `Action`, `createAuthz`, `DEFAULT_ROLES`.
- **Authorize with the existing action `content.create`.** Do NOT add a new `Action` to the authz vocabulary.
- **Auth is a seam, not real auth.** The dev resolver returns `{ id: 'local', role: 'owner' }`. No login/JWT/session.
- **Cost/safety:** size cap default **25 MB** (`25 * 1024 * 1024`); content-type **allowlist** (below); blocked types → 415. Non-image types served with `Content-Disposition: attachment`. No SVG, no HTML/JS/CSS.
- **Key scheme:** `media/<uuid>/original.<ext>` — `crypto.randomUUID()`, extension derived from the **content-type** (not the filename).
- **Default allowlist (content types):** `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `text/plain`, `text/csv`, `text/markdown`, `application/zip`, `audio/mpeg`, `audio/wav`, `video/mp4`, `video/webm`.
- **No DB record / metadata persistence, no image variants, no S3, no editor block** — out of scope (later media slices).
- **Patterns to mirror:** Hono factory shape = `apps/api/src/app.ts` (`createGitApi`); api test shape = `apps/api/test/app.test.ts` (`app.fetch(new Request(...))`, tmpdir + `afterEach` cleanup); admin component test shape = `apps/admin/test/sidebar.test.tsx` (`@testing-library/react`, `MemoryRouter`). Tests run with `pnpm --filter <pkg> test`.

---

### Task 1: Auth seam — actor resolver + authn middleware

**Files:**
- Create: `apps/api/src/auth/resolve-actor.ts`
- Create: `apps/api/src/auth/middleware.ts`
- Test: `apps/api/test/auth-middleware.test.ts`

**Interfaces:**
- Consumes: `Actor` from `@setu/core`; `createMiddleware` from `hono/factory`.
- Produces:
  - `type ResolveActor = (req: Request) => Actor | null | Promise<Actor | null>`
  - `const resolveLocalOwner: ResolveActor` → always `{ id: 'local', role: 'owner' }`
  - `function authMiddleware(resolveActor: ResolveActor)` → a Hono middleware that sets `c.set('actor', actor)` or returns `401 { error: 'unauthenticated' }` when the resolver yields null. The middleware is typed `createMiddleware<{ Variables: { actor: Actor } }>`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/auth-middleware.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Actor } from '@setu/core'
import { authMiddleware } from '../src/auth/middleware'
import { resolveLocalOwner } from '../src/auth/resolve-actor'

function appWith(resolve: (req: Request) => Actor | null) {
  const app = new Hono<{ Variables: { actor: Actor } }>()
  app.use('*', authMiddleware(resolve))
  app.get('/whoami', (c) => c.json({ actor: c.get('actor') }))
  return app
}
const req = (app: Hono<any>, path: string) => app.fetch(new Request(`http://test${path}`))

describe('authMiddleware', () => {
  it('sets the actor and continues when the resolver returns one', async () => {
    const res = await req(appWith(resolveLocalOwner), '/whoami')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ actor: { id: 'local', role: 'owner' } })
  })

  it('returns 401 when the resolver returns null', async () => {
    const res = await req(appWith(() => null), '/whoami')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('resolveLocalOwner is the single local owner', () => {
    expect(resolveLocalOwner(new Request('http://test/'))).toEqual({ id: 'local', role: 'owner' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/api test auth-middleware`
Expected: FAIL — cannot find `../src/auth/middleware` / `../src/auth/resolve-actor`.

- [ ] **Step 3: Write the implementation**

`apps/api/src/auth/resolve-actor.ts`:
```ts
import type { Actor } from '@setu/core'

/** Resolve the acting user for a request, or null if unauthenticated.
 *  This is the seam real auth (JWT/session) slots into later — without
 *  touching any route. */
export type ResolveActor = (req: Request) => Actor | null | Promise<Actor | null>

/** Dev resolver — the single local owner the admin already assumes. */
export const resolveLocalOwner: ResolveActor = () => ({ id: 'local', role: 'owner' })
```

`apps/api/src/auth/middleware.ts`:
```ts
import { createMiddleware } from 'hono/factory'
import type { Actor } from '@setu/core'
import type { ResolveActor } from './resolve-actor'

/** Authentication seam: sets c.get('actor'); 401 when the resolver returns null. */
export function authMiddleware(resolveActor: ResolveActor) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    const actor = await resolveActor(c.req.raw)
    if (!actor) return c.json({ error: 'unauthenticated' }, 401)
    c.set('actor', actor)
    await next()
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/api test auth-middleware`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/ apps/api/test/auth-middleware.test.ts
git commit -m "feat(api): auth seam — actor resolver + authn middleware"
```

---

### Task 2: Upload service — `POST /media`

**Files:**
- Create: `apps/api/src/media.ts`
- Test: `apps/api/test/media-upload.test.ts`

**Interfaces:**
- Consumes: `StoragePort` from `@setu/core`; `createAuthz`, `DEFAULT_ROLES`, `Actor` from `@setu/core`; `ResolveActor` + `authMiddleware` from Task 1; `cors` from `hono/cors`.
- Produces:
  - `interface UploadLimits { maxBytes: number; allowedContentTypes: Set<string> }`
  - `const DEFAULT_ALLOWED: Set<string>` (the allowlist from Global Constraints)
  - `const DEFAULT_MAX_BYTES = 25 * 1024 * 1024`
  - `interface UploadApiOptions { storage: StoragePort; resolveActor: ResolveActor; limits?: Partial<UploadLimits> }`
  - `function createUploadApi(opts: UploadApiOptions): Hono` — mounts `POST /media`. (The `GET /uploads/*` route is added in Task 3, same file/factory.)
  - `POST /media` response (201): `{ id: string; key: string; url: string; contentType: string; size: number; filename: string }`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/media-upload.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

/** Inline in-memory StoragePort fake (value-semantics: copies bytes both ways). */
function memStorage(): StoragePort & { map: Map<string, StoredObject> } {
  const map = new Map<string, StoredObject>()
  return {
    map,
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `http://test/uploads/${key}` },
  }
}

const owner: Actor = { id: 'local', role: 'owner' }
const viewer: Actor = { id: 'v', role: 'viewer' }

function makeApp(resolve: () => Actor | null, opts?: { maxBytes?: number; storage?: ReturnType<typeof memStorage> }) {
  const storage = opts?.storage ?? memStorage()
  const app = createUploadApi({
    storage,
    resolveActor: resolve,
    limits: opts?.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : undefined,
  })
  return { app, storage }
}

function post(app: ReturnType<typeof createUploadApi>, file?: File) {
  const body = new FormData()
  if (file) body.append('file', file)
  return app.fetch(new Request('http://test/media', { method: 'POST', body }))
}

const png = (bytes = 4, name = 'a.png', type = 'image/png') =>
  new File([new Uint8Array(bytes).fill(7)], name, { type })

describe('POST /media', () => {
  it('stores the file and returns a loadable url (201)', async () => {
    const { app, storage } = makeApp(() => owner)
    const res = await post(app, png(4))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.key).toMatch(/^media\/[0-9a-f-]{36}\/original\.png$/)
    expect(json.url).toBe(`http://test/uploads/${json.key}`)
    expect(json.contentType).toBe('image/png')
    expect(json.size).toBe(4)
    expect(json.filename).toBe('a.png')
    const stored = await storage.get(json.key)
    expect(stored?.contentType).toBe('image/png')
    expect(stored?.body.length).toBe(4)
  })

  it('derives the extension from the content-type, not the filename', async () => {
    const { app } = makeApp(() => owner)
    const res = await post(app, png(2, 'weird-name.bin', 'application/pdf'))
    const json = await res.json()
    expect(json.key).toMatch(/\/original\.pdf$/)
  })

  it('401 when unauthenticated', async () => {
    const { app } = makeApp(() => null)
    expect((await post(app, png())).status).toBe(401)
  })

  it('403 when the actor lacks content.create', async () => {
    const { app } = makeApp(() => viewer)
    const res = await post(app, png())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('400 when no file field is present', async () => {
    const { app } = makeApp(() => owner)
    const res = await post(app)
    expect(res.status).toBe(400)
  })

  it('413 when the file exceeds maxBytes', async () => {
    const { app } = makeApp(() => owner, { maxBytes: 3 })
    const res = await post(app, png(10))
    expect(res.status).toBe(413)
  })

  it('415 when the content-type is not allowed', async () => {
    const { app } = makeApp(() => owner)
    expect((await post(app, png(4, 'x.svg', 'image/svg+xml'))).status).toBe(415)
    expect((await post(app, png(4, 'x.html', 'text/html'))).status).toBe(415)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/api test media-upload`
Expected: FAIL — cannot find `../src/media`.

- [ ] **Step 3: Write the implementation**

`apps/api/src/media.ts`:
```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Actor, StoragePort } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

/** content-type → file extension. Its keyset IS the default allowlist. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

export const DEFAULT_ALLOWED: Set<string> = new Set(Object.keys(EXT_BY_TYPE))

export interface UploadLimits {
  maxBytes: number
  allowedContentTypes: Set<string>
}
export interface UploadApiOptions {
  storage: StoragePort
  resolveActor: ResolveActor
  limits?: Partial<UploadLimits>
}

const authz = createAuthz(DEFAULT_ROLES)

export function createUploadApi(opts: UploadApiOptions): Hono {
  const maxBytes = opts.limits?.maxBytes ?? DEFAULT_MAX_BYTES
  const allowed = opts.limits?.allowedContentTypes ?? DEFAULT_ALLOWED
  const { storage } = opts

  const app = new Hono<{ Variables: { actor: Actor } }>()
  app.use('*', cors())

  app.post('/media', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'content.create')) return c.json({ error: 'forbidden' }, 403)

    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'no file' }, 400)

    if (file.size > maxBytes) return c.json({ error: 'file too large' }, 413)
    if (!allowed.has(file.type)) return c.json({ error: `unsupported type: ${file.type}` }, 415)

    const id = crypto.randomUUID()
    const ext = EXT_BY_TYPE[file.type]
    const key = `media/${id}/original.${ext}`
    const bytes = new Uint8Array(await file.arrayBuffer())
    await storage.put(key, bytes, { contentType: file.type })

    return c.json(
      { id, key, url: storage.url(key), contentType: file.type, size: file.size, filename: file.name },
      201,
    )
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/api test media-upload`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/media.ts apps/api/test/media-upload.test.ts
git commit -m "feat(api): POST /media — auth-gated upload to StoragePort"
```

---

### Task 3: Serving route — `GET /uploads/*`

**Files:**
- Modify: `apps/api/src/media.ts` (add the GET route inside `createUploadApi`)
- Test: `apps/api/test/media-serve.test.ts`

**Interfaces:**
- Consumes: the `createUploadApi` factory from Task 2 (same `storage`).
- Produces: `GET /uploads/*` — maps the wildcard path to a storage key, returns the bytes with `Content-Type` from the stored object; `image/*` is served inline, every other type with `Content-Disposition: attachment`; absent key → `404 { error: 'not found' }`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/media-serve.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Actor, StoragePort, StoredObject } from '@setu/core'
import { createUploadApi } from '../src/media'

function memStorage(): StoragePort {
  const map = new Map<string, StoredObject>()
  return {
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `http://test/uploads/${key}` },
  }
}
const owner: Actor = { id: 'local', role: 'owner' }

async function uploadThenServe(file: File) {
  const storage = memStorage()
  const app = createUploadApi({ storage, resolveActor: () => owner })
  const body = new FormData(); body.append('file', file)
  const up = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
  const { key } = await up.json()
  const res = await app.fetch(new Request(`http://test/uploads/${key}`))
  return { res, key }
}

describe('GET /uploads/*', () => {
  it('serves an image inline with its content-type and exact bytes', async () => {
    const { res } = await uploadThenServe(new File([new Uint8Array([1, 2, 3, 4])], 'a.png', { type: 'image/png' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('serves a non-image as an attachment', async () => {
    const { res } = await uploadThenServe(new File([new Uint8Array([5, 6])], 'a.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment')
  })

  it('404 for an absent key', async () => {
    const storage = memStorage()
    const app = createUploadApi({ storage, resolveActor: () => owner })
    const res = await app.fetch(new Request('http://test/uploads/media/nope/original.png'))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/api test media-serve`
Expected: FAIL — `GET /uploads/...` returns 404 for an existing object (route not yet defined), so the first two assertions fail.

- [ ] **Step 3: Add the GET route**

In `apps/api/src/media.ts`, add this route inside `createUploadApi`, immediately **before** the `app.onError(...)` line:
```ts
  app.get('/uploads/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/uploads/'.length))
    const obj = await storage.get(key)
    if (!obj) return c.json({ error: 'not found' }, 404)
    const headers: Record<string, string> = { 'Content-Type': obj.contentType }
    if (!obj.contentType.startsWith('image/')) headers['Content-Disposition'] = 'attachment'
    return new Response(obj.body, { status: 200, headers })
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/api test media-serve`
Expected: PASS (3 tests). Also re-run the upload suite to confirm no regression: `pnpm --filter @setu/api test media`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/media.ts apps/api/test/media-serve.test.ts
git commit -m "feat(api): GET /uploads/* — serve stored bytes (image inline, else attachment)"
```

---

### Task 4: Wire into the server + config + end-to-end with real `storage-local`

**Files:**
- Modify: `apps/api/package.json` (add `@setu/storage-local` dependency)
- Modify: `apps/api/src/server.ts`
- Modify: `.gitignore` (add `.setu/`)
- Test: `apps/api/test/media-e2e.test.ts`

**Interfaces:**
- Consumes: `createLocalStorage({ dir, baseUrl })` from `@setu/storage-local`; `createUploadApi` (Task 2/3); `resolveLocalOwner` (Task 1).
- Produces: production wiring in `server.ts` (no exported symbols); a green e2e test proving the real disk adapter round-trips through the upload + serve routes.

- [ ] **Step 1: Add the dependency**

Edit `apps/api/package.json` — add to `"dependencies"` (keep alphabetical with the other `@setu/*`):
```json
    "@setu/storage-local": "workspace:*",
```
Then install: `pnpm install` (from repo root).

- [ ] **Step 2: Write the failing test**

`apps/api/test/media-e2e.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '@setu/storage-local'
import { createUploadApi } from '../src/media'

const dirs: string[] = []
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0 })

function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'media-'))
  dirs.push(dir)
  const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/uploads' })
  return { app: createUploadApi({ storage, resolveActor: () => ({ id: 'local', role: 'owner' }) }), dir }
}

describe('media upload e2e (real storage-local on disk)', () => {
  it('uploads to disk and serves the bytes back', async () => {
    const { app, dir } = freshApp()
    const body = new FormData()
    body.append('file', new File([new Uint8Array([9, 8, 7])], 'pic.webp', { type: 'image/webp' }))

    const up = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(up.status).toBe(201)
    const { key, url } = await up.json()
    expect(url).toBe(`http://localhost:4444/uploads/${key}`)
    expect(existsSync(join(dir, key))).toBe(true)

    const served = await app.fetch(new Request(`http://test/uploads/${key}`))
    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]))
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @setu/api test media-e2e`
Expected: FAIL — cannot resolve `@setu/storage-local` until Step 1's install completes; if install ran, it passes already (the factories exist). If it passes here, that is acceptable — this task's deliverable is the wiring + dependency; proceed to Step 4.

- [ ] **Step 4: Wire `server.ts`**

Replace `apps/api/src/server.ts` with:
```ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { createGitApi } from './app'
import { createPreviewApi } from './preview'
import { createUploadApi } from './media'
import { resolveLocalOwner } from './auth/resolve-actor'

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const mediaDir = process.env.SETU_MEDIA_DIR ?? `${dir}/.setu/uploads`
const mediaPublicUrl = process.env.SETU_MEDIA_PUBLIC_URL ?? `http://localhost:${port}/uploads`

const app = new Hono()
app.route('/', createGitApi(createLocalGitAdapter({ dir })))
app.route('/', createPreviewApi())
app.route('/', createUploadApi({
  storage: createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl }),
  resolveActor: resolveLocalOwner,
}))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir}, media: ${mediaDir})`)
```

- [ ] **Step 5: Gitignore the upload dir**

Add to `.gitignore` (at the end):
```
# Uploaded media (local dev storage)
.setu/
```

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm --filter @setu/api test media-e2e && pnpm --filter @setu/api typecheck`
Expected: PASS (1 test) + typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/server.ts .gitignore apps/api/test/media-e2e.test.ts pnpm-lock.yaml
git commit -m "feat(api): wire upload service into server with storage-local + config"
```

---

### Task 5: Admin upload client

**Files:**
- Create: `apps/admin/src/media/upload-client.ts`
- Test: `apps/admin/test/upload-client.test.ts`

**Interfaces:**
- Consumes: the `POST /media` response shape from Task 2.
- Produces:
  - `interface UploadResult { id: string; key: string; url: string; contentType: string; size: number; filename: string }`
  - `async function uploadFile(apiBase: string, file: File): Promise<UploadResult>` — posts `FormData` (field `file`) to `${apiBase}/media`; on a non-OK response throws `Error` with the server's `error` message (falling back to `upload failed (<status>)`).

- [ ] **Step 1: Write the failing test**

`apps/admin/test/upload-client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadFile } from '../src/media/upload-client'

afterEach(() => vi.restoreAllMocks())
const file = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' })

describe('uploadFile', () => {
  it('posts FormData to <apiBase>/media and returns the parsed result', async () => {
    const result = { id: '1', key: 'media/1/original.png', url: 'http://api/uploads/media/1/original.png', contentType: 'image/png', size: 2, filename: 'a.png' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(result), { status: 201, headers: { 'content-type': 'application/json' } }),
    )
    const out = await uploadFile('http://api', file)
    expect(out).toEqual(result)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api/media')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('throws the server error message on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unsupported type: image/svg+xml' }), { status: 415 }),
    )
    await expect(uploadFile('http://api', file)).rejects.toThrow('unsupported type: image/svg+xml')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test upload-client`
Expected: FAIL — cannot find `../src/media/upload-client`.

- [ ] **Step 3: Write the implementation**

`apps/admin/src/media/upload-client.ts`:
```ts
export interface UploadResult {
  id: string
  key: string
  url: string
  contentType: string
  size: number
  filename: string
}

/** POST a file to the upload service and return the stored asset's details. */
export async function uploadFile(apiBase: string, file: File): Promise<UploadResult> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch(`${apiBase}/media`, { method: 'POST', body })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `upload failed (${res.status})`)
  }
  return (await res.json()) as UploadResult
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/admin test upload-client`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/media/upload-client.ts apps/admin/test/upload-client.test.ts
git commit -m "feat(admin): uploadFile client for the media upload service"
```

---

### Task 6: Admin Media screen (the visible win)

**Files:**
- Create: `apps/admin/src/screens/Media.tsx`
- Modify: `apps/admin/src/app.tsx` (route `/media` → `<Media />` instead of `<Placeholder title="Media" />`)
- Test: `apps/admin/test/media-screen.test.tsx`

**Interfaces:**
- Consumes: `uploadFile`, `UploadResult` from Task 5; `PageHeader` from `apps/admin/src/shell/PageHeader`.
- Produces: a `Media` screen — a file input that, on selection, calls `uploadFile(import.meta.env.VITE_SETU_API, file)`; on success renders the returned `url` as a link and, when `contentType` starts with `image/`, an `<img>` preview; on error shows the message. No grid, no delete, no persistence.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/media-screen.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as client from '../src/media/upload-client'
import { Media } from '../src/screens/Media'

afterEach(() => vi.restoreAllMocks())

function pickFile() {
  const input = screen.getByTestId('media-file-input') as HTMLInputElement
  const file = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('Media screen', () => {
  it('uploads a picked file and shows the link + image preview', async () => {
    vi.spyOn(client, 'uploadFile').mockResolvedValue({
      id: '1', key: 'media/1/original.png', url: 'http://api/uploads/media/1/original.png',
      contentType: 'image/png', size: 2, filename: 'a.png',
    })
    render(<Media />)
    pickFile()
    const link = await screen.findByRole('link', { name: /original\.png/ })
    expect(link).toHaveAttribute('href', 'http://api/uploads/media/1/original.png')
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://api/uploads/media/1/original.png')
  })

  it('shows the error message when the upload fails', async () => {
    vi.spyOn(client, 'uploadFile').mockRejectedValue(new Error('file too large'))
    render(<Media />)
    pickFile()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('file too large'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test media-screen`
Expected: FAIL — cannot find `../src/screens/Media`.

- [ ] **Step 3: Write the screen**

`apps/admin/src/screens/Media.tsx`:
```tsx
import { useState } from 'react'
import { PageHeader } from '../shell/PageHeader'
import { uploadFile, type UploadResult } from '../media/upload-client'

export function Media() {
  const apiBase = import.meta.env.VITE_SETU_API as string | undefined
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    try {
      setResult(await uploadFile(apiBase ?? '', file))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <section className="media">
      <PageHeader title="Media" subtitle="Upload a file and get a link." />
      <input data-testid="media-file-input" type="file" onChange={onPick} disabled={busy} />
      {busy && <p className="muted">Uploading…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="media-result">
          {result.contentType.startsWith('image/') && (
            <img src={result.url} alt={result.filename} style={{ maxWidth: 320, display: 'block' }} />
          )}
          <a href={result.url} target="_blank" rel="noreferrer">{result.filename}</a>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Wire the route**

In `apps/admin/src/app.tsx`:
- Add the import after the other screen imports:
```tsx
import { Media } from './screens/Media'
```
- Replace the `/media` route line:
```tsx
          <Route path="/media" element={<Media />} />
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @setu/admin test media-screen && pnpm --filter @setu/admin typecheck`
Expected: PASS (2 tests) + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/screens/Media.tsx apps/admin/src/app.tsx apps/admin/test/media-screen.test.tsx
git commit -m "feat(admin): Media screen — drop a file, get a link"
```

---

## Final verification (after all tasks)

- [ ] Run the full suite + typecheck across the workspace:
  - `pnpm -r test`
  - `pnpm -r typecheck`
  - Expected: all green (the new api + admin tests included; core's edge guard unchanged since `@setu/core` was not modified).
- [ ] Manual smoke (optional): `pnpm dev`, open the admin `/media` page, upload a PNG and a PDF; the PNG shows a preview + link, the PDF shows a download link; both URLs load.

## Notes for the executor

- **Node globals:** `File`, `FormData`, `Blob`, `crypto.randomUUID()` are all global in the Node 22 runtime (`@types/node` ^22) and in the api/admin test environments — no imports needed.
- **`@setu/core` is off-limits** this slice. If a task seems to need a core change, stop and escalate — the design deliberately reuses `content.create` and the shipped `StoragePort` so core stays untouched.
- **Mirror existing tests:** api tests use `app.fetch(new Request(...))`; admin tests use `@testing-library/react`. Do not introduce a new HTTP client or test harness.
