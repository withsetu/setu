# Saytu Local Bridge (editor→disk, Cut A) — Design

> The first cut of the **editor→disk bridge / multi-topology** epic (roadmap → Backend/Platform).
> **In WordPress terms:** today the admin is a demo that can't save to the real site. This makes
> **Publish write the actual `.mdoc` file (a real git commit) that the live site renders** — on one
> machine. Topology = **Local** (Node runtime + local `.git` + in-browser drafts). The fuller cuts
> (server-side drafts/locks via SQLite = "Cut B"; the `git-github` + `db-d1` adapters for
> self-hosted/edge) are named follow-ons — each is an adapter swap with **zero service rewrites**.

**Goal:** from the local admin, hitting **Publish** sends the post to a small local Node server that
commits the real `.mdoc` into the repo's `content/` folder; the running site renders it. Create →
Publish → live, single machine.

**Architecture:** the publish/read/authoring **services already exist and are adapter-agnostic**
(`servicesFor(data, git)`), and the publish service already compiles a draft → Markdoc and commits
to `content/<collection>/<locale>/<slug>.mdoc` with a HEAD conflict guard. This increment routes the
**GitPort** (only) to a server: a Hono (Node) API wraps the existing `git-local` adapter; a new
browser-side `git-http` GitPort `fetch`es that API; `Bootstrap.tsx` uses `git-http` when a server URL
is configured, else falls back to the current in-browser `git-idb` (so the bridge is **additive** —
existing tests/demo untouched). Content is aligned to the engine's existing repo-root convention so
a commit lands where the site globs.

**Tech stack:** Hono 4.12.26 + @hono/node-server 2.0.5 (verified on npm) · the existing
`@saytu/git-local` (isomorphic-git) · a new `@saytu/git-http` (fetch-based GitPort) · `@saytu/core`
ports/services (unchanged) · Astro 6 glob content loader · Vitest. **100% OSS.**

---

## 1. Scope

### In scope
- **Content convention — repo-root `content/`.** Move the 4 site fixtures from
  `apps/saytu-site/content/` → repo-root `content/`; change the Astro glob `base` to read the
  repo-root folder; `git-local`'s `dir` = repo root (which has `.git`). This **aligns the site to the
  core's existing `contentPath` convention** (`content/<collection>/<locale>/<slug>.mdoc`) — the
  engine already assumes content at repo root; the site was the outlier.
- **`apps/saytu-api` — a Hono (Node) server** exposing the **GitPort** over HTTP (the 4 operations
  the services use: `headSha`, `readFile`, `commitFile`, `list`), backed by
  `createLocalGitAdapter({ dir: <repoRoot> })`. Local-only, no auth. Runs via `@hono/node-server`.
- **`packages/git-http` — a browser-side `GitPort`** (`createHttpGitPort({ baseUrl })`) implementing
  the same 4 operations via `fetch`. A drop-in GitPort; **passes the shared `runGitPortContract`**.
- **Admin wiring (`apps/saytu-admin/src/data/Bootstrap.tsx`)** — when `import.meta.env.VITE_SAYTU_API`
  is set, build the GitPort via `createHttpGitPort({ baseUrl })` (DataPort stays `db-idb`); otherwise
  the **current in-browser path is unchanged** (`git-idb`, memory fallback). The services bundle is
  built by the existing `bootstrapServices(data, git)` — no UI/service change.
- **One-command dev runner** — a root script that boots `api + admin + site` together (you can't use
  the feature otherwise). Labeled output, non-colliding ports, one Ctrl-C stops all.
- **Tests:** `git-http` against `runGitPortContract` (in-process Hono server backed by an in-memory
  or local git); `apps/saytu-api` endpoint integration tests; an **end-to-end** test that publishes
  through the real service stack over `git-http` and asserts the `.mdoc` lands in `content/`
  (and renders via the site build); admin 178 + site tests stay green.

### Out of scope (named, anti-creep)
- **Server-side drafts/locks (SQLite) — "Cut B".** Drafts stay in-browser this cut. No DataPort over
  HTTP, no `db-sqlite` wiring, no shared edit-locks.
- **`git-github` adapter / remote-git / push-pull-fetch.** `git-local` has no `fetch`/`pull`/`push`;
  the "local behind remote" sync is future. Single faucet, single machine this cut.
- **Edge / Cloudflare (Worker, `db-d1`, GitHub API), auth/tokens, the productized "user repo depends
  on Saytu" restructuring, SSR preview, the "View Page" links.** All later.
- **No change to the publish/read/authoring services, the converter, or the round-trip.** This cut is
  plumbing: a server + an adapter + content relocation + wiring.

---

## 2. Content convention (the path alignment)

The core already emits repo-relative `content/<collection>/<locale>/<slug>.mdoc` (`contentPath`).
`git-local` commits relative to its `dir`; with `dir` = repo root, a publish lands at
`<repo>/content/…`. So the site must read `<repo>/content/`:

- **Move:** `apps/saytu-site/content/{page/en/about,page/en/home,post/en/kitchen-sink,post/fr/bonjour}.mdoc`
  → `content/…` at the repo root (same sub-layout).
- **Site loader:** `apps/saytu-site/src/content.config.ts` — change
  `glob({ pattern: '**/*.mdoc', base: './content' })` to read the repo-root folder.
  **VERIFY-FIRST (build task):** confirm Astro's glob `base` resolves a folder *above* the app dir
  (e.g. `'../../content'` or an absolute path via `new URL`/`fileURLToPath`). **Fallback if base
  can't escape the app root:** keep the site reading its own `content/` and make the API/git-local
  write there instead — i.e. configure the server's git-local `dir` = repo root but commit under a
  configured content root (`apps/saytu-site/content/…`) by passing a path prefix; the publish path is
  derived from `contentPath`, so the prefix is applied at the API/adapter boundary, not in core.
  (Preferred: repo-root `content/`, matching the core convention; the fallback exists so the build
  is never blocked.)
- **Dev pickup:** in dev, Astro's content loader watches the content dir → a new committed file
  triggers HMR/reload, so "Publish → see it on the site" works without a manual rebuild. **VERIFY**
  this in the build/e2e task; if dev-watch doesn't fire on an external commit, a manual refresh /
  rebuild is the documented v1 behavior.

## 3. `apps/saytu-api` — the Hono GitPort server (Node)

A thin RPC-style exposure of the GitPort. One adapter instance: `createLocalGitAdapter({ dir })`
where `dir` is the repo root (resolved from the server's CWD / an env var). Endpoints mirror the
GitPort 1:1 (exact request/response shapes finalized in the plan; JSON bodies):
- `GET  /git/head` → `{ sha: string | null }`  (`headSha()`)
- `GET  /git/file?path=…` → `{ content: string | null }`  (`readFile(path)`)
- `POST /git/commit` `{ path, content, message, author }` → `{ sha }`  (`commitFile(...)`)
- `GET  /git/list?prefix=…` → `{ paths: string[] }`  (`list(prefix?)`)

Served via `@hono/node-server`'s `serve({ fetch: app.fetch, port })`. CORS allowed for the admin dev
origin. Errors map to non-2xx with a JSON `{ error }`; the path-escape guard in `git-local` stays the
safety net. **No auth** (local-only; documented as such). **VERIFY-FIRST:** the exact
`@hono/node-server` `serve` signature + Hono routing/JSON helpers before asserting them.

## 4. `packages/git-http` — the browser-side GitPort adapter

`createHttpGitPort({ baseUrl, fetch? }): GitPort` implementing `headSha`/`readFile`/`commitFile`/
`list` by calling the §3 endpoints with `fetch` (injectable for tests). It is a **GitPort** — the
same interface `git-local`/`git-idb`/`git-memory` implement — so the services consume it unchanged.
A non-2xx or network error throws (the services already handle GitPort errors). Browser-safe (only
`fetch`, no Node imports). New package mirroring the other adapter packages (`@saytu/core` dep,
vitest, tsconfig).

## 5. Admin wiring (`Bootstrap.tsx`)

Additive branch — the only app change:
```
if (import.meta.env.VITE_SAYTU_API) {
  const git = createHttpGitPort({ baseUrl: import.meta.env.VITE_SAYTU_API })
  const data = await createIdbDataPort()           // drafts stay in-browser (Cut A)
  ready = await bootstrapServices(data, git)
} else {
  // unchanged current path: createIdbDataPort()+createIdbGitPort(), memory fallback
}
```
No services/UI change (`bootstrapServices` + `servicesFor` already adapter-agnostic). Existing 178
admin tests run the in-browser path → untouched. Add `@saytu/git-http` to the admin's deps.

## 6. Dev orchestration

A root `dev` script booting all three: `apps/saytu-api` (Node server), `apps/saytu-admin` (Vite),
`apps/saytu-site` (Astro), with `VITE_SAYTU_API` pointed at the api port. Use a small, OSS,
parallel-runner approach (e.g. `pnpm -r --parallel` with per-app `dev` scripts, or a tiny
`concurrently`-style dep) with labeled output, fixed non-colliding ports, one-Ctrl-C shutdown.
**This also resolves the deferred "single dev command" roadmap item.** Keep it minimal; the bridge
is the deliverable, the runner is the on-ramp.

## 7. Testing

- **`git-http` ⇄ GitPort contract:** run the existing `runGitPortContract` (from `@saytu/git-testing`)
  against `createHttpGitPort` pointed at an **in-process Hono app** backed by a git adapter — the
  same contract `git-local`/`git-idb`/`git-memory` pass. This proves the HTTP adapter is a faithful
  GitPort.
- **`apps/saytu-api` endpoints:** integration tests hitting each route (head/read/commit/list) against
  a temp `git init` repo via `git-local`, asserting commits land + round-trip.
- **End-to-end bridge:** drive the **real publish service** with `git-http` (in-process server +
  git-local on a temp repo); publish a draft; assert the `.mdoc` exists at
  `content/<…>.mdoc` with the compiled body, and (build assertion) the site renders it from the
  relocated content root.
- **No-regression:** `apps/saytu-admin` 178 tests green (in-browser branch unchanged); `apps/saytu-site`
  tests green after the content move (build reads repo-root `content/`); whole repo green; both apps
  build.

## 8. Success criteria
1. With the dev runner up, **Publish in the local admin writes a real `.mdoc` git commit** into
   repo-root `content/` and the running site renders it (create → publish → live).
2. `git-http` is a drop-in **GitPort** (passes `runGitPortContract`); the admin uses it only when
   `VITE_SAYTU_API` is set, else the **in-browser path is unchanged** (178 admin tests green).
3. The publish/read/authoring **services, the converter, and the round-trip are untouched** — this is
   plumbing (server + adapter + content relocation + wiring).
4. Content lives at **repo-root `content/`** (the core convention); the site reads it; the 4 fixtures
   moved; site tests green.
5. Drafts remain in-browser (Cut A); SQLite drafts/locks, `git-github`, `db-d1`, and edge are absent
   by design (named follow-ons).

## 9. Risks & decisions
- **Astro glob `base` above the app dir** is the one build unknown (§2) — verify-first, with a
  concrete fallback (write under the site's own content root via a path prefix at the API boundary)
  so the increment is never blocked.
- **`git-local` serializes commits** (existing `serialize()`), so the single-writer API is safe under
  rapid publishes. No new concurrency model needed for Cut A.
- **Additive wiring** — the bridge is gated by `VITE_SAYTU_API`; the in-browser mode (and its 178
  tests + the no-server demo) is the untouched default. No risk to existing behavior.
- **Known v1 limitations (stated, not discovered):** drafts don't travel across devices (in-browser);
  "local behind remote" needs git-local `fetch`/`pull` (not built — only matters with a 2nd faucet);
  concurrent-editor conflicts are coarse (whole-repo HEAD guard) until locks are wired to a shared DB;
  the local API has no auth (local-only). All deferred per the topology roadmap.
- **No submodule** for content (decided): a submodule pins a SHA and would rebuild stale content;
  same-repo `content/` now, "user-repo-depends-on-Saytu" later.

---

See [[saytu-project]], the roadmap's "editor→disk bridge / multi-topology" section, and PRD §2.
