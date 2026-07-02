# T1 — Playwright E2E harness — report

Status: **DONE**

## What was built

- `e2e/playwright.config.ts` — root-relative config (resolves `repoRoot` from
  `import.meta.url`, never `process.cwd()`), with:
  - `webServer` array: api on port **4446** (`SETU_API_PORT=4446`,
    `SETU_REPO_DIR=<repoRoot>/.content-sandbox/e2e`,
    `SETU_MEDIA_DIR=<repoRoot>/.setu/e2e-uploads`), admin on port **5175**
    (`vite --port 5175 --strictPort`, `VITE_SETU_API=http://localhost:4446`,
    `VITE_SETU_SITE=http://localhost:4321`). Site is not booted.
  - `reuseExistingServer: !process.env.CI` on both, startup timeouts 60s (api)
    / 30s (admin).
  - Projects: `chromium` (all `**/*.spec.ts`), `webkit-editor`
    (`**/editor-*.spec.ts`, matches nothing yet), `firefox-full` +
    `webkit-full` (full-suite, only when `E2E_FULL_MATRIX` is set), `visual`
    (`**/*.visual.spec.ts`, matches nothing yet).
  - `ignoreSnapshots: !process.env.CI`, `fullyParallel: true`,
    `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 1 : 0`,
    reporters `html` (never auto-opens) + `line`, `trace: 'on-first-retry'`,
    `screenshot: 'only-on-failure'`.
  - `outputDir` / html `outputFolder` explicitly anchored under `e2e/` — by
    default Playwright resolves these relative to `process.cwd()` (repo root,
    since `pnpm e2e` runs from there), which would have littered
    `test-results/`/`playwright-report/` at repo root instead of under `e2e/`.
    Caught and fixed during verification (see Decisions).
- `e2e/global-setup.ts` — imports `resetSandbox` from
  `scripts/content-sandbox.mjs` (name `e2e`), wipes + recreates
  `.setu/e2e-uploads/`.
- `e2e/specs/smoke.spec.ts` — navigates to `/`, asserts
  `getByRole('heading', { level: 1, name: 'Dashboard' })` and
  `getByRole('link', { name: 'Dashboard' })` (the sidebar nav item) are
  visible. Both are real accessible names read from
  `apps/admin/src/shell/PageHeader.tsx` (renders `title` as `<h1>`) and
  `apps/admin/src/shell/AppSidebar.tsx` (`NavLink` → `<a>` via shadcn
  `SidebarMenuButton asChild`). No CSS-class or test-id selectors.
- Root `package.json`: added `"e2e": "playwright test -c e2e"` and
  `"e2e:ui": "playwright test -c e2e --ui"` scripts; `@playwright/test@^1.61.1`
  added as a **root** devDependency (`pnpm add -Dw`). `e2e/` has no
  `package.json` — not a workspace package, invisible to
  `pnpm -r test`/`pnpm -r typecheck`, and `pnpm-workspace.yaml` untouched.
- `.gitignore`: added `e2e/test-results/` and `e2e/playwright-report/`.
  `.setu/` (covers `.setu/e2e-uploads/`) and `.content-sandbox/` (covers
  `.content-sandbox/e2e/`) were already ignored — no change needed there.

## Decisions / things I verified rather than assumed

1. **`globalSetup` vs `webServer` ordering (flagged as uncertain in the
   brief).** Verified empirically on the installed `playwright@1.61.1`: ran
   the suite repeatedly from a wiped `.content-sandbox/e2e` — the api
   (`SETU_REPO_DIR` pointed at the sandbox) consistently came up healthy and
   served `/git/head` with 200 on every run, which is only possible if
   `resetSandbox` (which does `git init` + first commit) had already run
   before the api process read the directory. No wrapper-command workaround
   needed; `globalSetup: './global-setup.ts'` in config is sufficient.
2. **Api `webServer.url` health check.** Hono has no root route in
   `apps/api/src/server.ts`, so `GET /` 404s. Playwright's `webServer` polling
   (`isURLAvailable`) does **not** treat 404 as "available" — it kept retrying
   `/` and `/index.html` until the 60s timeout and failed the run. Fixed by
   pointing the health-check URL at a real endpoint, `GET /git/head` (defined
   in `apps/api/src/app.ts`, returns 200 once the git adapter is ready).
3. **ESM `__dirname`.** Root `package.json` has `"type": "module"`, so `.ts`
   config files load as native ESM under Playwright's loader — bare
   `__dirname` throws `ReferenceError`. Both `playwright.config.ts` and
   `global-setup.ts` derive it via
   `path.dirname(fileURLToPath(import.meta.url))`.
4. **Output dirs leaking to repo root.** First `pnpm e2e` run created
   `playwright-report/` and `test-results/` at the repo root (relative to
   `process.cwd()`), not under `e2e/`, which would not have matched the new
   `.gitignore` entries. Fixed with explicit `outputDir` and html
   `outputFolder` paths anchored at the config file's own directory.
5. **Selectors** were read from the real components, not invented: `h1` text
   comes from `PageHeader`'s `title` prop as passed by `Dashboard.tsx`
   (`"Dashboard"`); the nav link accessible name comes from `AppSidebar`'s
   `NAV` array (`{ to: '/dashboard', label: 'Dashboard' }`), rendered as an
   `<a>` (react-router `NavLink`) via `SidebarMenuButton asChild` (shadcn
   `Slot.Root` merges props onto the child, so the DOM node keeps its `<a>`
   tag and picks up an implicit `link` role).
6. Root `/` redirects to `/dashboard` via `<Navigate to="/dashboard" replace />`
   in `apps/admin/src/App.tsx`; no login gate — `resolveLocalOwner` in
   `apps/api/src/auth/resolve-actor.ts` always resolves a local owner actor,
   confirmed by reading the file.
7. Code style matched to neighboring files (no semicolons, single quotes,
   `const`, arrow functions) — repo has no root `tsconfig.json`, ESLint, or
   Prettier config to enforce this automatically; verified by reading
   `scripts/content-sandbox.mjs` and `apps/api/src/app.ts`.

## Verification — `pnpm e2e` output (chromium; webkit-editor matches 0 files)

Ran from a clean state (`.content-sandbox/e2e`, `.setu/e2e-uploads`,
`e2e/playwright-report`, `e2e/test-results` all removed first) after
`npx playwright install chromium webkit`:

```
> setu@0.0.0 e2e /Users/mayank/Documents/projects/setu/.claude/worktrees/e2e-foundation
> playwright test -c e2e --reporter=list

Running 1 test using 1 worker

  ✓  1 [chromium] › e2e/specs/smoke.spec.ts:3:1 › admin dashboard renders at / (534ms)

  1 passed (3.0s)
EXIT: 0
```

Re-ran multiple times (including back-to-back with `reuseExistingServer`
torn down between runs) — consistently 1 passed, exit 0. Confirmed via
`npx playwright test -c e2e --list` that `webkit-editor`'s `testMatch` matches
0 files and does not fail the run (exit 0, "Total: 1 test in 1 file" — only
chromium's smoke test is listed). Confirmed via
`E2E_FULL_MATRIX=1 npx playwright test -c e2e --list` that `firefox-full` and
`webkit-full` register correctly and pick up the same spec ("Total: 3 tests in
1 file").

Confirmed `git add -n e2e/` stages only the 3 real source files
(`global-setup.ts`, `playwright.config.ts`, `specs/smoke.spec.ts`) —
`playwright-report/` and `test-results/` are correctly gitignored.

Confirmed `pnpm -r list --depth -1` does not list an `e2e` workspace package
(no `package.json` under `e2e/`), so `pnpm -r test` / `pnpm -r typecheck` are
unaffected by this change.

Confirmed no stray listeners left on ports 4446/5175 after the run
(`lsof -i :4446 -i :5175` empty post-run, aside from one leftover from my own
manual debugging session which I killed manually — not a Playwright teardown
issue).

## Concerns

- `firefox`/`webkit-full` full-matrix projects and `visual` project are wired
  but genuinely unexercised beyond `--list` (no visual specs exist yet, and
  I did not install the firefox browser binary — only chromium + webkit per
  the brief's exact instruction). This is expected for T1; later tasks add
  specs that will exercise them.
- The admin's `VITE_SETU_SITE` fallback (`apps/admin/src/shell/site-url.ts`)
  means the dashboard renders fine with the site down, as required — but I
  did not specifically hunt for a widget that throws when the site is
  unreachable; the smoke test's role-based assertions passed cleanly, which
  is the actual bar T1 sets.
- `webServer` env vars use plain objects with computed values (`String(...)`,
  `path.join(...)`); Playwright requires plain string values, which these
  are — no dynamic/async values.

## Fix: webServer/globalSetup ordering

**Finding (Important, source-verified review).** T1's original claim that
`globalSetup` runs before `webServer` was wrong for the installed
`playwright@1.61.1`. Reading the installed package's source
(`createGlobalSetupTasks()`) shows the real sequence: output-dir cleanup ->
webServer plugin setup (which starts each `webServer` process and health-polls
it) -> user `globalSetup` LAST. My original "empirical verification" (repeated
runs from a wiped sandbox all came up healthy) was consistent with this bug,
not proof against it — a fresh sandbox is absent, not stale, so `/git/head`
still 200s on a first boot either way (the local git adapter creates the repo
lazily / the health check doesn't actually require pre-existing content). The
gap only shows up with a **stale** sandbox left over from an interrupted prior
run: the api would boot and serve it for the whole run before `global-setup.ts`
got a chance to wipe it — silently. `/git/head` doesn't distinguish "fresh
empty repo" from "stale leftover repo," so the health check green-lights a
stale sandbox too.

**Fix applied.**

1. **Sandbox reset moved into the api's `webServer.command`** in
   `e2e/playwright.config.ts`: `'node scripts/content-sandbox.mjs reset e2e && pnpm --filter @setu/api dev'`,
   `cwd: repoRoot` unchanged (the script resolves its `root` from
   `process.cwd()`, which is `repoRoot` when Playwright spawns it with that
   `cwd`). This `&&`-chain runs the wipe-and-reseed synchronously to
   completion *before* `pnpm --filter @setu/api dev` starts, so the api never
   opens a git adapter against a stale or half-wiped directory. Env vars for
   the api process are untouched.

2. **Media dir wipe: kept in `globalSetup`, not moved.** Decided by reading
   `apps/api/src/server.ts` and `packages/storage-local/src/index.ts`:
   - `server.ts` constructs `createLocalStorage({ dir: mediaDir, baseUrl: mediaPublicUrl })`
     at module top-level (before `serve()`), but `createLocalStorage` itself
     does no fs I/O at construction — it just closes over `dir`.
   - Every `StoragePort` method is lazy and per-request: `put` calls
     `mkdir(dirname(path), { recursive: true })` itself before writing;
     `get`/`exists`/`delete` catch `ENOENT` and treat it as "not found"; `list`'s
     recursive `walk` catches `ENOENT` and returns `[]`. Nothing at api
     *startup* stats, reads, or requires the media dir to pre-exist.
   - The only startup-time `mkdirSync` in `server.ts` is for `${dir}/.setu`
     (the SQLite DB parent), which is a different path from
     `SETU_MEDIA_DIR=.setu/e2e-uploads` and unrelated to this bug.
   - Therefore the earliest anything touches `.setu/e2e-uploads` is a test's
     own HTTP request to the api, and no test runs until `globalSetup` has
     already returned — so wiping it in `globalSetup` (even though that now
     runs after webServer boot) cannot race a real read/write. Left as-is;
     `global-setup.ts` no longer imports `resetSandbox` (that logic moved to
     the webServer command) but keeps the media-dir wipe, so the file was
     trimmed rather than deleted, and the `globalSetup` config reference in
     `playwright.config.ts` stays.
   - Updated the misleading header comment in `global-setup.ts` (previously
     asserted the wrong ordering with a broken citation) to state the correct,
     source-verified ordering and the reasoning above.

**Verification (real runs, this session).**

a. Clean-sandbox run:
   ```
   $ rm -rf .content-sandbox/e2e && pnpm e2e
   Running 1 test using 1 worker
     [1/1] [chromium] › e2e/specs/smoke.spec.ts:3:1 › admin dashboard renders at /
     1 passed (3.0s)
   EXIT: 0

   $ ls -la .content-sandbox/e2e && git -C .content-sandbox/e2e log --oneline
   drwxr-xr-x .git
   drwxr-xr-x .setu
   drwxr-xr-x content
   1139973 seed sandbox from canonical content/
   ```
   Green, and `.content-sandbox/e2e` exists post-run with a real seeded git
   repo — created by the pre-boot reset in the webServer command.

b. Stale-marker run (proves wipe-then-reseed actually executes before the api
   serves the sandbox, not just that the dir exists):
   ```
   $ touch .content-sandbox/e2e/STALE-MARKER
   $ ls .content-sandbox/e2e/ | grep STALE
   STALE-MARKER

   $ pnpm e2e
   Running 1 test using 1 worker
     [1/1] [chromium] › e2e/specs/smoke.spec.ts:3:1 › admin dashboard renders at /
     1 passed (3.0s)
   EXIT: 0

   $ ls .content-sandbox/e2e/
   content
   $ test -f .content-sandbox/e2e/STALE-MARKER && echo BAD || echo "marker gone (good)"
   marker gone (good)
   ```
   Green, and the marker — planted directly in the sandbox root, which
   `resetSandbox` wipes with `rmSync(..., { recursive: true, force: true })`
   before reseeding — is gone afterward. Before the fix this would have stayed
   present all run (the api boots and serves the stale dir; `global-setup.ts`'s
   wipe, running after, would still remove it, but only *after* the test run
   already exercised the stale state — with a slower-booting api or a longer
   suite this is exactly the silent-stale-sandbox window the finding
   describes). With the fix, the wipe is guaranteed complete before the api
   process (and therefore any test) ever sees the directory.

c. No artifact leakage at repo root:
   ```
   $ test -d test-results && echo BAD || echo "absent (good)"
   absent (good)
   $ test -d playwright-report && echo BAD || echo "absent (good)"
   absent (good)
   $ ls e2e/ | grep -E "test-results|playwright-report"
   playwright-report
   test-results
   ```
   Confirms `outputDir`/html `outputFolder` anchoring (from the original T1
   work) still holds — artifacts land under `e2e/`, not repo root, and stay
   gitignored there.

**Files changed:** `e2e/playwright.config.ts` (webServer `command` for the
api project), `e2e/global-setup.ts` (dropped the `resetSandbox` call and its
import, corrected the header comment, kept the media-dir wipe). No change to
`e2e/specs/smoke.spec.ts`, `package.json`, or `.gitignore`.
