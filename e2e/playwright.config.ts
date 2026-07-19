import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Resolve the repo root from this file's location — never process.cwd(), since
// `pnpm e2e` (via `playwright test -c e2e`) may be invoked from anywhere.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const API_PORT = 4446
const ADMIN_PORT = 5175
const apiUrl = `http://localhost:${API_PORT}`
const adminUrl = `http://localhost:${ADMIN_PORT}`
// The api has no root route (Hono 404s on `/`) — poll a real endpoint instead.
const apiHealthUrl = `${apiUrl}/git/head`

// Real auth (SessionGate is active whenever VITE_SETU_API is set — apps/admin/src/main.tsx), so the
// suite must log in. The `setup` project mints per-role session state here; test projects load the
// admin state by default (full access ≈ the old implicit owner) and the auth-* specs override it.
const authDir = path.join(__dirname, '.auth')
const adminStorageState = path.join(authDir, 'admin.json')

const fullMatrix = !!process.env.E2E_FULL_MATRIX

export default defineConfig({
  testDir: './specs',
  // Anchor output under e2e/ regardless of cwd — Playwright otherwise resolves
  // these relative to process.cwd() (the repo root when run via `pnpm e2e`).
  outputDir: path.join(__dirname, 'test-results'),
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    [
      'html',
      { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }
    ],
    ['line']
  ],
  // Visual baselines are captured on Linux CI; ignore local diffs elsewhere.
  ignoreSnapshots: !process.env.CI,
  use: {
    baseURL: adminUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },

  // Baseline screenshots are pixel-sensitive to viewport size and to the browser/platform
  // metadata Playwright embeds in the snapshot filename by default. We commit
  // baselines from CI (Linux) artifacts only (see T7 report), so the default
  // `{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}` template is fine as-is —
  // it's already deterministic per (spec, project, platform) triple and every CI run is the
  // same platform (linux), so we do not override `snapshotPathTemplate`.
  projects: [
    {
      // Logs in through the real UI once per role and saves session state to e2e/.auth/*.json.
      // Every test project depends on it; the auth-* specs that test login/gate override storageState.
      name: 'setup',
      testMatch: /auth\.setup\.ts/
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: adminStorageState },
      dependencies: ['setup'],
      testMatch: '**/*.spec.ts',
      // The visual project below owns *.visual.spec.ts — without this, chromium's broad
      // `**/*.spec.ts` would ALSO pick up visual specs and run them a second time (with
      // ignoreSnapshots still honored, so it wouldn't fail here, but it would double the
      // work and muddy `--list`/reporting).
      testIgnore: '**/*.visual.spec.ts'
    },
    {
      name: 'webkit-editor',
      use: { ...devices['Desktop Safari'], storageState: adminStorageState },
      dependencies: ['setup'],
      testMatch: '**/editor-*.spec.ts',
      // editor-*.spec.ts never matches *.visual.spec.ts today, but pin it explicitly so a
      // future editor visual spec doesn't silently double-run here too.
      testIgnore: '**/*.visual.spec.ts'
    },
    ...(fullMatrix
      ? [
          {
            name: 'firefox-full',
            use: {
              ...devices['Desktop Firefox'],
              storageState: adminStorageState
            },
            dependencies: ['setup'],
            testMatch: '**/*.spec.ts',
            testIgnore: '**/*.visual.spec.ts'
          },
          {
            name: 'webkit-full',
            use: {
              ...devices['Desktop Safari'],
              storageState: adminStorageState
            },
            dependencies: ['setup'],
            testMatch: '**/*.spec.ts',
            testIgnore: '**/*.visual.spec.ts'
          }
        ]
      : []),
    {
      name: 'visual',
      dependencies: ['setup'],
      use: {
        storageState: adminStorageState,
        ...devices['Desktop Chrome'],
        // Explicit, not inherited from the device default — a Playwright bump changing
        // Desktop Chrome's default viewport must not silently reflow every baseline.
        viewport: { width: 1280, height: 720 },
        // motion/react's useReducedMotion() (used by ResumeEditing/ContentTable row
        // entrance animations) reads this media query at runtime and the components
        // already branch on it to skip their animation entirely — Playwright's built-in
        // `animations: 'disabled'` (toHaveScreenshot's default) only freezes CSS
        // animations/transitions, not this JS-driven library, so it can't do this alone.
        // NOTE: `reducedMotion` is NOT a top-level `use` option in Playwright 1.61 — a
        // bare `use.reducedMotion` typechecks nowhere and is silently ignored at runtime
        // (caught by the e2e tsc gate, T8); it must go through `contextOptions`.
        contextOptions: { reducedMotion: 'reduce' }
      },
      testMatch: '**/*.visual.spec.ts'
    }
  ],

  // Dedicated ports (4446/5175) so a running `pnpm dev` stack (4444/5173) is
  // never disturbed. The site (4321) is intentionally not booted — the admin
  // dashboard must tolerate it being down.
  webServer: [
    {
      // Playwright starts webServer BEFORE globalSetup (createGlobalSetupTasks
      // sequences: output-dir cleanup -> webServer plugin setup -> user
      // globalSetup last) — see e2e/global-setup.ts for the full citation. So
      // the sandbox reset must run here, `&&`-chained ahead of the api boot,
      // not in globalSetup. NOTE the `/git/head` health check is only a
      // process-liveness signal — it returns 200 even for a missing/empty
      // SETU_REPO_DIR (git-local maps NotFoundError to `{ sha: null }`), so it
      // does NOT gate on the sandbox being seeded; ordering correctness comes
      // entirely from the shell `&&`. cwd is repoRoot so the script's own
      // `process.cwd()`-based root resolution is correct.
      command:
        'node scripts/content-sandbox.mjs reset e2e && pnpm --filter @setu/api dev',
      url: apiHealthUrl,
      cwd: repoRoot,
      env: {
        // Explicit, not inherited (#643). The api's `dev` script happens to set SETU_MODE=local,
        // and that indirection is what currently makes the in-editor preview slot mount in this
        // harness — resolvePreviewEnabled requires local mode AND non-production (apps/api's
        // config.ts, hardened in #627). Nothing in this file said so, so a change to that script
        // would silently 404 /preview and take the preview specs with it. Declaring it here makes
        // the harness's topology a property of the harness. Same value the script sets, so this
        // changes no behavior; it removes a hidden dependency.
        SETU_MODE: 'local',
        SETU_API_PORT: String(API_PORT),
        SETU_REPO_DIR: path.join(repoRoot, '.content-sandbox', 'e2e'),
        SETU_MEDIA_DIR: path.join(repoRoot, '.setu', 'e2e-uploads'),
        // The admin runs on ADMIN_PORT (5175), not the 5173 default — so the CORS/origin allowlist
        // MUST be told the real admin origin, or the cross-origin capabilities GET and the login
        // POST are rejected and the app never leaves the loading/login wall. (This mismatch is the
        // class of bug the rescue/248-cors-fix branch had to fix; here the harness would silently
        // fail to authenticate without it.)
        SETU_ADMIN_ORIGIN: adminUrl,
        // Deterministic auth lane: the harness signs in several times per run and Better Auth's
        // /sign-in/email limit (3/10s) shares one bucket for loopback traffic, so a CI retry could
        // trip a 429 that masks the real result. Default stays ON everywhere else.
        SETU_AUTH_RATELIMIT_ENABLED: 'false'
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: `pnpm --filter @setu/admin exec vite --port ${ADMIN_PORT} --strictPort`,
      url: adminUrl,
      cwd: repoRoot,
      env: {
        VITE_SETU_API: apiUrl,
        VITE_SETU_SITE: 'http://localhost:4321'
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    }
  ]
})
