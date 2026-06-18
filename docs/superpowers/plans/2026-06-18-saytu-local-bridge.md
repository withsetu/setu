# Local Bridge (editor→disk, Cut A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the local admin, hitting **Publish** sends the post to a small local Node server that commits the real `.mdoc` into the repo's `content/` folder; the running site renders it (create → publish → live, one machine).

**Architecture:** The publish/read/authoring services already exist and are GitPort-agnostic. This increment routes the **GitPort** (only) to a server: a Hono (Node) API wraps the existing `git-local`; a new browser-side `git-http` GitPort `fetch`es it; `Bootstrap.tsx` uses `git-http` when `VITE_SETU_API` is set, else the current in-browser `git-idb` path is unchanged (additive). Content is aligned to the engine's existing repo-root `content/` convention so a commit lands where the site globs.

**Tech Stack:** Hono 4.12.26 + @hono/node-server 2.0.5 · existing `@setu/git-local` (isomorphic-git) · new `@setu/git-http` (fetch GitPort) · `@setu/core` ports/services (unchanged) · Astro 6 glob loader · Vitest · tsx (dev) · concurrently (dev runner).

## Global Constraints

- **100% OSS** — hono, @hono/node-server, tsx, concurrently are all MIT. No paid deps.
- **Plumbing only** — do NOT touch the publish/read/authoring **services**, the Markdoc converter, or the round-trip. This is a server + an adapter + a content move + wiring.
- **Additive bridge** — gated by `import.meta.env.VITE_SETU_API`; the in-browser path (and the 178 admin tests + no-server demo) is the untouched default.
- **Strict TS** (`tsconfig.base.json`): `verbatimModuleSyntax` → `import type` for type-only imports; `noUncheckedIndexedAccess` → guard every index / parsed-JSON field; `strict`.
- **Verified npm deps (do NOT re-verify):** `hono@4.12.26`, `@hono/node-server@2.0.5`. `tsx` and `concurrently` are MIT (confirm they install; pick current versions).
- **HARD RULE** — verify any *other* new dep/API claim before asserting: Hono `Hono()` routing + `c.req.query`/`c.req.json`/`c.json` signatures, `hono/cors`, `@hono/node-server` `serve({fetch,port})`, Astro glob `base` resolving a folder above the app dir, `concurrently`/`tsx` invocation, and `Request`/`app.fetch` in the contract injection.
- **GitPort interface** (`@setu/core`): `headSha(): Promise<string|null>`, `readFile(path:string): Promise<string|null>`, `commitFile(input: CommitInput): Promise<CommitResult>`, `list(prefix?:string): Promise<string[]>`. `CommitInput = { path, content, message, author: { name, email } }`; `CommitResult = { sha }`.
- **Commit footer** (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Content convention — content at repo-root `content/`

Align the site to the engine's existing convention (the core already writes `content/<collection>/<locale>/<slug>.mdoc`). Move the fixtures up to the repo root and point the site loader at them.

**Files:**
- Move: `apps/site/content/{page/en/about.mdoc, page/en/home.mdoc, post/en/kitchen-sink.mdoc, post/fr/bonjour.mdoc}` → `content/…` (repo root, same sub-layout)
- Modify: `apps/site/src/content.config.ts` (glob `base`)
- Test: existing `apps/site/test/render.test.ts` + `test/theme-options.test.ts` (must stay green)

**Interfaces:**
- Produces: canonical content at repo-root `content/`. `git-local` with `dir` = repo root commits there; the site reads there.

- [ ] **Step 1: Move the fixtures with git (preserve history)**

```bash
mkdir -p content/page/en content/post/en content/post/fr
git mv apps/site/content/page/en/about.mdoc      content/page/en/about.mdoc
git mv apps/site/content/page/en/home.mdoc       content/page/en/home.mdoc
git mv apps/site/content/post/en/kitchen-sink.mdoc content/post/en/kitchen-sink.mdoc
git mv apps/site/content/post/fr/bonjour.mdoc    content/post/fr/bonjour.mdoc
```
Confirm `apps/site/content/` is now empty (remove the empty dir if git left it).

- [ ] **Step 2: Point the site loader at repo-root content (VERIFY-FIRST)**

Edit `apps/site/src/content.config.ts`. Current:
```ts
const entries = defineCollection({ loader: glob({ pattern: '**/*.mdoc', base: './content' }) })
```
Change `base` to the repo-root content folder. **Try first** (project root = `apps/site`, so two levels up is the repo root):
```ts
const entries = defineCollection({ loader: glob({ pattern: '**/*.mdoc', base: '../../content' }) })
```
**Build to verify Astro accepts a base above the app dir:**
```bash
pnpm --filter @setu/site build
```
If the build can't find the entries / rejects the relative base, use an absolute path resolved from this file instead:
```ts
import { fileURLToPath } from 'node:url'
// content.config.ts lives in apps/site/src/ → repo root is three levels up
const contentBase = fileURLToPath(new URL('../../../content', import.meta.url))
const entries = defineCollection({ loader: glob({ pattern: '**/*.mdoc', base: contentBase }) })
```
Pick whichever the build actually resolves (the dist must contain the 4 routes). **FALLBACK (only if neither form lets Astro read above the app root):** revert the move, keep content at `apps/site/content/`, and instead make the API server (Task 2) write there by configuring its git-local content-root prefix — note this decision loudly in the commit and tell the controller, because it changes Task 2's `dir`/path handling. Strongly prefer repo-root `content/`.

- [ ] **Step 3: Run the site test suite (no regression)**

Run: `pnpm --filter @setu/site test`
Expected: all green (render tests + theme-options) — the build now reads repo-root `content/`; rendered HTML is unchanged because the files are byte-identical, only relocated.

- [ ] **Step 4: Commit**

```bash
git add -A content apps/site/src/content.config.ts
git commit -m "refactor(site): read content from repo-root content/ (engine convention) (#bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `apps/api` — the Hono GitPort server (Node)

A thin RPC exposure of the GitPort, backed by `git-local`. Exposes a `createGitApi(git)` app factory (importable by Task 3's test) plus a `server.ts` entry.

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/app.ts` (`createGitApi`)
- Create: `apps/api/src/server.ts` (the Node entry)
- Test: `apps/api/test/app.test.ts`

**Interfaces:**
- Consumes: `GitPort`, `createLocalGitAdapter({ dir })` (from `@setu/git-local`).
- Produces: `createGitApi(git: GitPort): Hono` (exported from `@setu/api`, package main `./src/app.ts`). Routes: `GET /git/head` → `{ sha: string|null }`; `GET /git/file?path=` → `{ content: string|null }` (400 `{ error }` if `path` missing); `POST /git/commit` body `{ path, content, message, author }` → `{ sha: string }`; `GET /git/list?prefix=` → `{ paths: string[] }`. Errors → non-2xx `{ error }`.

- [ ] **Step 1: Scaffold the package**

Create `apps/api/package.json`:
```json
{
  "name": "@setu/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/app.ts",
  "types": "./src/app.ts",
  "exports": { ".": "./src/app.ts" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "2.0.5",
    "@setu/core": "workspace:*",
    "@setu/git-local": "workspace:*",
    "hono": "4.12.26"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "isomorphic-git": "^1.38.4",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```
(`isomorphic-git` is a devDep only for the test's `git.init`. Confirm the latest `tsx` 4.x installs; adjust the caret if needed.)

Create `apps/api/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["node"] }, "include": ["src", "test"] }
```
Run `pnpm install` from the repo root.

- [ ] **Step 2: VERIFY the Hono / node-server API surface (HARD RULE)**

Before writing `app.ts`, confirm against the installed packages (read `node_modules` types or the docs): `new Hono()`, `app.get(path, (c) => …)`, `app.post(...)`, `c.req.query('x')` returns `string | undefined`, `await c.req.json()`, `c.json(obj, status?)`, `app.use('*', cors())` from `hono/cors`, `app.onError((err, c) => …)`, and `app.fetch(request: Request): Promise<Response>`. From `@hono/node-server`: `serve({ fetch, port })`. Note any signature differences and adapt the code below.

- [ ] **Step 3: Write the failing test**

Create `apps/api/test/app.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '@setu/git-local'
import { createGitApi } from '../src/app'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

async function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'api-'))
  dirs.push(dir)
  await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
  return createGitApi(createLocalGitAdapter({ dir }))
}

const req = (app: ReturnType<typeof createGitApi>, path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://test${path}`, init))

const author = { name: 'Ed', email: 'ed@example.com' }

describe('createGitApi', () => {
  it('GET /git/head returns null sha on an empty repo', async () => {
    const app = await freshApp()
    const res = await req(app, '/git/head')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sha: null })
  })

  it('POST /git/commit returns a sha; GET /git/file reads it back', async () => {
    const app = await freshApp()
    const commit = await req(app, '/git/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'content/post/en/x.mdoc', content: '# Hi\n', message: 'add', author }),
    })
    expect(commit.status).toBe(200)
    const { sha } = (await commit.json()) as { sha: string }
    expect(typeof sha).toBe('string')

    const head = await (await req(app, '/git/head')).json()
    expect(head).toEqual({ sha })

    const file = await (await req(app, '/git/file?path=content/post/en/x.mdoc')).json()
    expect(file).toEqual({ content: '# Hi\n' })

    const missing = await (await req(app, '/git/file?path=content/none.mdoc')).json()
    expect(missing).toEqual({ content: null })
  })

  it('GET /git/list filters by prefix', async () => {
    const app = await freshApp()
    const mk = (path: string) =>
      req(app, '/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content: 'x', message: 'm', author }),
      })
    await mk('content/post/en/a.mdoc')
    await mk('setu.config.ts')
    const { paths } = (await (await req(app, '/git/list?prefix=content/')).json()) as { paths: string[] }
    expect(paths).toEqual(['content/post/en/a.mdoc'])
  })

  it('GET /git/file without a path returns 400', async () => {
    const app = await freshApp()
    const res = await req(app, '/git/file')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toHaveProperty('error')
  })
})
```

- [ ] **Step 4: Run it, confirm it FAILS**

Run: `pnpm --filter @setu/api test`
Expected: FAIL — `../src/app` not found.

- [ ] **Step 5: Implement `src/app.ts`**

Create `apps/api/src/app.ts` (adapt to any signature notes from Step 2):
```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { GitPort, CommitInput } from '@setu/core'

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort and the listener (server.ts). */
export function createGitApi(git: GitPort): Hono {
  const app = new Hono()
  app.use('*', cors())

  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '') return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  app.post('/git/commit', async (c) => {
    const body = (await c.req.json()) as CommitInput
    const { sha } = await git.commitFile(body)
    return c.json({ sha })
  })

  app.get('/git/list', async (c) => {
    const prefix = c.req.query('prefix')
    return c.json({ paths: await git.list(prefix) })
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
```

- [ ] **Step 6: Run the test, confirm PASS**

Run: `pnpm --filter @setu/api test`
Expected: all green.

- [ ] **Step 7: Write the server entry**

Create `apps/api/src/server.ts`:
```ts
import { serve } from '@hono/node-server'
import { createLocalGitAdapter } from '@setu/git-local'
import { createGitApi } from './app'

const dir = process.env.SETU_REPO_DIR ?? process.cwd()
const port = Number(process.env.SETU_API_PORT ?? 4444)
const app = createGitApi(createLocalGitAdapter({ dir }))

serve({ fetch: app.fetch, port })
console.log(`api listening on http://localhost:${port} (repo: ${dir})`)
```

- [ ] **Step 8: Smoke-test the server boots + typecheck**

```bash
SETU_REPO_DIR="$(git rev-parse --show-toplevel)" SETU_API_PORT=4444 pnpm --filter @setu/api exec tsx src/server.ts &
sleep 2
curl -s http://localhost:4444/git/head; echo
curl -s "http://localhost:4444/git/list?prefix=content/"; echo
kill %1
pnpm --filter @setu/api typecheck
```
Expected: `/git/head` returns a JSON `{ "sha": "…" }` (non-null, since the repo has commits) and `/git/list?prefix=content/` lists the relocated `.mdoc` files. Typecheck clean. (If `kill %1` is awkward in the runner, find+kill the tsx PID on port 4444.)

- [ ] **Step 9: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): @setu/api — Hono GitPort server over git-local (#bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `packages/git-http` — the browser-side GitPort adapter

A `fetch`-based GitPort that talks to the Task 2 routes. Contract-tested against the **real** `createGitApi` in-process (portless, via an injected `fetch`).

**Files:**
- Create: `packages/git-http/package.json`
- Create: `packages/git-http/tsconfig.json`
- Create: `packages/git-http/src/adapter.ts`
- Create: `packages/git-http/src/index.ts`
- Test: `packages/git-http/test/contract.test.ts`

**Interfaces:**
- Consumes: `GitPort`, `CommitInput`, `CommitResult` (`@setu/core`); `createGitApi` (`@setu/api`, test only); `createMemoryGitPort` (`@setu/git-memory`, test only); `runGitPortContract` (`@setu/git-testing`).
- Produces: `createHttpGitPort(opts: HttpGitOptions): GitPort` where `HttpGitOptions = { baseUrl: string; fetch?: typeof fetch }`.

- [ ] **Step 1: Scaffold the package (mirror git-memory)**

Create `packages/git-http/package.json`:
```json
{
  "name": "@setu/git-http",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@setu/api": "workspace:*",
    "@setu/git-memory": "workspace:*",
    "@setu/git-testing": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```
(The test-only devDep on `@setu/api` is an intentional, test-only package←app edge so the adapter is contract-tested against the real routes — document this in the file header comment.)

Create `packages/git-http/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```
Run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing contract test**

Create `packages/git-http/test/contract.test.ts`:
```ts
import { runGitPortContract } from '@setu/git-testing'
import { createGitApi } from '@setu/api'
import { createMemoryGitPort } from '@setu/git-memory'
import { createHttpGitPort } from '../src/index'

// Contract-tests the HTTP adapter against the REAL api routes, in-process and
// portless: each case gets a fresh in-memory git + a fresh Hono app, and the
// adapter's fetch is wired straight to app.fetch (no network, no port).
runGitPortContract(() => {
  const app = createGitApi(createMemoryGitPort())
  return createHttpGitPort({
    baseUrl: 'http://localhost',
    fetch: (input, init) => app.fetch(new Request(input as string, init)),
  })
})
```

- [ ] **Step 3: Run it, confirm it FAILS**

Run: `pnpm --filter @setu/git-http test`
Expected: FAIL — `../src/index` not found.

- [ ] **Step 4: Implement the adapter**

Create `packages/git-http/src/adapter.ts`:
```ts
import type { GitPort, CommitInput, CommitResult } from '@setu/core'

export interface HttpGitOptions {
  /** Base URL of the Saytu git API (e.g. http://localhost:4444). */
  baseUrl: string
  /** Injectable fetch (tests wire this to an in-process Hono app). Defaults to global fetch. */
  fetch?: typeof fetch
}

/** A GitPort that talks to the Saytu git API (apps/api) over HTTP.
 *  Browser-safe: only uses fetch. The same GitPort contract as git-local/idb/memory. */
export function createHttpGitPort(opts: HttpGitOptions): GitPort {
  const base = opts.baseUrl.replace(/\/$/, '')
  const doFetch = opts.fetch ?? fetch
  const url = (path: string) => `${base}${path}`

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`git-http ${res.status}: ${body}`)
    }
    return (await res.json()) as T
  }

  return {
    async headSha() {
      const { sha } = await json<{ sha: string | null }>(await doFetch(url('/git/head')))
      return sha
    },
    async readFile(path) {
      const { content } = await json<{ content: string | null }>(
        await doFetch(url(`/git/file?path=${encodeURIComponent(path)}`)),
      )
      return content
    },
    async commitFile(input: CommitInput): Promise<CommitResult> {
      const { sha } = await json<{ sha: string }>(
        await doFetch(url('/git/commit'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
      return { sha }
    },
    async list(prefix?: string) {
      const q = prefix === undefined ? '' : `?prefix=${encodeURIComponent(prefix)}`
      const { paths } = await json<{ paths: string[] }>(await doFetch(url(`/git/list${q}`)))
      return paths
    },
  }
}
```

Create `packages/git-http/src/index.ts`:
```ts
export { createHttpGitPort } from './adapter'
export type { HttpGitOptions } from './adapter'
```

- [ ] **Step 5: Run the contract test, confirm PASS**

Run: `pnpm --filter @setu/git-http test`
Expected: the full GitPort contract passes (same suite git-local/idb/memory pass).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @setu/git-http typecheck`
Expected: clean (the `json<T>` guard handles `noUncheckedIndexedAccess`; `import type` for the core types).

- [ ] **Step 7: Commit**

```bash
git add packages/git-http pnpm-lock.yaml
git commit -m "feat(git-http): browser-side GitPort adapter over the Saytu git API (#bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Admin wiring — use `git-http` when a server is configured

Additive branch in the bootstrap; the in-browser default is untouched.

**Files:**
- Modify: `apps/admin/src/data/Bootstrap.tsx`
- Modify: `apps/admin/package.json` (add `@setu/git-http`)
- Test: `apps/admin` existing suite (178) stays green

**Interfaces:**
- Consumes: `createHttpGitPort` (`@setu/git-http`), `createIdbDataPort` (`@setu/db-idb`), `bootstrapServices` (`./store`).

- [ ] **Step 1: Add the dependency**

In `apps/admin/package.json` `dependencies`, add `"@setu/git-http": "workspace:*"`. Run `pnpm install` from the repo root.

- [ ] **Step 2: Add the env-gated branch in `Bootstrap.tsx`**

Edit `apps/admin/src/data/Bootstrap.tsx`. Add the import:
```ts
import { createHttpGitPort } from '@setu/git-http'
```
Inside the existing async IIFE, branch BEFORE the current try/catch so the server path takes precedence when configured. Replace the body that computes `ready` with:
```ts
const apiBase = import.meta.env.VITE_SETU_API
let ready: Services
if (apiBase) {
  // Server-backed GitPort (Cut A): Publish commits to the real repo via the API.
  // Drafts stay in-browser (IndexedDB) this cut.
  const data = await createIdbDataPort()
  const git = createHttpGitPort({ baseUrl: apiBase })
  ready = await bootstrapServices(data, git)
} else {
  try {
    const data = await createIdbDataPort()
    const git = await createIdbGitPort()
    ready = await bootstrapServices(data, git)
  } catch (err) {
    console.error('IndexedDB unavailable — using in-memory storage for this session.', err)
    ready = await bootstrapServices(createMemoryDataPort(), createMemoryGitPort())
  }
}
```
(Keep the existing `live`/`setServices` handling around it unchanged.)

- [ ] **Step 3: Confirm the existing admin suite stays green**

Run: `pnpm --filter @setu/admin test`
Expected: 178 tests green. The tests don't set `VITE_SETU_API`, so they run the unchanged in-browser branch. (Console `act()` warnings + a deliberate error-path stack trace are pre-existing noise, not failures.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @setu/admin typecheck && pnpm --filter @setu/admin build`
Expected: clean; build succeeds (the new import resolves; `import.meta.env.VITE_SETU_API` is a standard Vite env access).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/data/Bootstrap.tsx apps/admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): use git-http GitPort when VITE_SETU_API is set (#bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: One-command dev runner

Boot `api + admin + site` together so the bridge is usable. Also closes the deferred "single dev command" roadmap item.

**Files:**
- Modify: root `package.json` (a `dev` script + `concurrently` devDep)
- Create: `apps/api/README.md` (short run note) — or append to an existing README

**Interfaces:** none (tooling).

- [ ] **Step 1: Add `concurrently` + the dev script**

Confirm `concurrently` installs (MIT; use the current 9.x). Add to root `package.json`:
```json
  "devDependencies": {
    "concurrently": "^9.1.0",
    "typescript": "^5.6.3"
  },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev": "concurrently -n api,admin,site -c blue,magenta,green \"pnpm --filter @setu/api dev\" \"VITE_SETU_API=http://localhost:4444 pnpm --filter @setu/admin dev\" \"pnpm --filter @setu/site dev\""
  }
```
The `@setu/api` `dev` script reads `SETU_API_PORT` (defaults 4444) and `SETU_REPO_DIR` (defaults `process.cwd()` = repo root when run from root). Ports: api 4444, admin 5173, site 4321 (defaults, non-colliding). Run `pnpm install`.

- [ ] **Step 2: VERIFY the runner boots all three**

```bash
pnpm dev &
sleep 6
curl -s http://localhost:4444/git/head >/dev/null && echo "api up"
curl -s http://localhost:5173 >/dev/null && echo "admin up"
curl -s http://localhost:4321 >/dev/null && echo "site up"
kill %1 2>/dev/null
```
Expected: "api up", "admin up", "site up". (If env-var-prefix in the concurrently command string is awkward on the runner's shell, set `SETU_REPO_DIR` explicitly and/or use a `cross-env`-free POSIX form; the admin must receive `VITE_SETU_API`. Adjust and re-verify — the goal is all three up with the admin pointed at the api.)

- [ ] **Step 3: Document the run command**

Create `apps/api/README.md`:
```markdown
# @setu/api — local git API

Exposes the GitPort (git-local) over HTTP so the in-browser admin can commit to the real repo.

## Run everything (api + admin + site)
From the repo root:

    pnpm dev

- api: http://localhost:4444  (env: SETU_API_PORT, SETU_REPO_DIR)
- admin: http://localhost:5173 (env: VITE_SETU_API → the api URL)
- site: http://localhost:4321

With the admin pointed at the api (VITE_SETU_API), **Publish** commits the real
`.mdoc` into repo-root `content/` and the site renders it. Without VITE_SETU_API the
admin runs fully in-browser (no server). Local-only; the api has no auth.
```

- [ ] **Step 4: Commit**

```bash
git add package.json apps/api/README.md pnpm-lock.yaml
git commit -m "feat(dev): one-command runner for api+admin+site; close single-dev-command item (#bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: End-to-end bridge test + full verification

Prove the whole stack: the real publish service → `git-http` → `createGitApi` → `git-local` on a temp repo → the `.mdoc` lands on disk.

**Files:**
- Test: `apps/api/test/e2e-publish.test.ts`

**Interfaces:**
- Consumes: `createPublishService`, `createMemoryDataPort`-style DataPort holding a draft, `createHttpGitPort`, `createGitApi`, `createLocalGitAdapter`.

- [ ] **Step 1: Write the end-to-end test**

Create `apps/api/test/e2e-publish.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '@setu/git-local'
import { createMemoryDataPort } from '@setu/db-memory'
import { createPublishService } from '@setu/core'
import { createHttpGitPort } from '@setu/git-http'
import { createGitApi } from '../src/app'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('end-to-end: publish over git-http → api → git-local → disk', () => {
  it('writes the compiled .mdoc to repo-relative content/ and returns published', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'saytu-e2e-'))
    dirs.push(dir)
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })

    // Server: real git-local on the temp repo, behind the real api routes.
    const app = createGitApi(createLocalGitAdapter({ dir }))

    // Client: the browser-side GitPort wired (portless) to the in-process app.
    const httpGit = createHttpGitPort({
      baseUrl: 'http://localhost',
      fetch: (input, init) => app.fetch(new Request(input as string, init)),
    })

    // Drafts live in-browser (Cut A): a DataPort holding one draft to publish.
    const data = createMemoryDataPort([
      { collection: 'post', locale: 'en', slug: 'hello', content: doc('Hello world.'), metadata: { title: 'Hello' } },
    ])

    const publish = createPublishService({ data, git: httpGit })
    const result = await publish.publish({
      ref: { collection: 'post', locale: 'en', slug: 'hello' },
      author: { name: 'Ed', email: 'ed@example.com' },
    })

    expect(result.status).toBe('published')
    if (result.status !== 'published') throw new Error('expected published')
    expect(result.path).toBe('content/post/en/hello.mdoc')
    expect(typeof result.sha).toBe('string')

    // The real file is on disk in the temp repo, with the compiled body.
    const onDisk = readFileSync(join(dir, 'content/post/en/hello.mdoc'), 'utf8')
    expect(onDisk).toContain('title: Hello')
    expect(onDisk).toContain('Hello world.')
  })
})
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm --filter @setu/api test`
Expected: both `app.test.ts` and `e2e-publish.test.ts` green. (If `@setu/db-memory`/`@setu/git-http` aren't resolvable from the api package, add them as devDeps to `apps/api/package.json` and `pnpm install`.)

- [ ] **Step 3: Full repo green**

Run: `pnpm -r test`
Expected: every package green — core, blocks, theme-default, site, admin (178), `@setu/git-http` (the contract suite), `@setu/api` (app + e2e), and the db/git packages. Capture the counts.

- [ ] **Step 4: Both apps build + typecheck the new packages**

```bash
pnpm --filter @setu/site build && pnpm --filter @setu/admin build
pnpm --filter @setu/api typecheck && pnpm --filter @setu/git-http typecheck
```
Expected: both builds succeed; typechecks clean.

- [ ] **Step 5: Confirm the in-browser admin path is unaffected**

Confirm `apps/admin` build with no `VITE_SETU_API` set still wires the in-browser branch (grep the built output / reason about the branch: `import.meta.env.VITE_SETU_API` is `undefined` → the `else` runs). The 178 admin tests (Step 3) already prove the in-browser branch is green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/e2e-publish.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "test(api): end-to-end publish over git-http → api → git-local → disk (#bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Worktree:** execute off `main` in an isolated worktree (subagent-driven-development + using-git-worktrees). Baseline-test before starting.
- **Finish flow (established default):** after all tasks + final review, merge `--no-ff` to local `main` → `pnpm install` on main → push via `gh`/HTTPS → remove the worktree. No PR.
- **The two genuine unknowns** (verify-first, don't guess): Task 1's Astro glob `base` above the app dir (with a documented fallback), and Task 2's exact Hono / @hono/node-server signatures. Everything else is mechanical or reuses proven patterns (the GitPort contract, the adapter package layout, the publish service).
- **Services are untouched** — if any task finds itself editing `packages/core/src/{publish,read,authoring,markdoc}/`, stop: this increment is plumbing only.
- After merge: update `memory/saytu-project.md` + `docs/roadmap.md` (mark the Local Bridge / Cut A shipped; next = Cut B server-side drafts/locks, or the `git-github`/edge adapters; this also closed the "single dev command" item).
