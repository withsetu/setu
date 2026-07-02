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
    ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }],
    ['line'],
  ],
  // Visual baselines are captured on Linux CI; ignore local diffs elsewhere.
  ignoreSnapshots: !process.env.CI,
  use: {
    baseURL: adminUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/*.spec.ts',
    },
    {
      name: 'webkit-editor',
      use: { ...devices['Desktop Safari'] },
      testMatch: '**/editor-*.spec.ts',
    },
    ...(fullMatrix
      ? [
          {
            name: 'firefox-full',
            use: { ...devices['Desktop Firefox'] },
            testMatch: '**/*.spec.ts',
          },
          {
            name: 'webkit-full',
            use: { ...devices['Desktop Safari'] },
            testMatch: '**/*.spec.ts',
          },
        ]
      : []),
    {
      name: 'visual',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/*.visual.spec.ts',
    },
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
      command: 'node scripts/content-sandbox.mjs reset e2e && pnpm --filter @setu/api dev',
      url: apiHealthUrl,
      cwd: repoRoot,
      env: {
        SETU_API_PORT: String(API_PORT),
        SETU_REPO_DIR: path.join(repoRoot, '.content-sandbox', 'e2e'),
        SETU_MEDIA_DIR: path.join(repoRoot, '.setu', 'e2e-uploads'),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @setu/admin exec vite --port ${ADMIN_PORT} --strictPort`,
      url: adminUrl,
      cwd: repoRoot,
      env: {
        VITE_SETU_API: apiUrl,
        VITE_SETU_SITE: 'http://localhost:4321',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
