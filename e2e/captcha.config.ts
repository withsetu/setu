import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// #868: the captcha e2e lane — a SEPARATE Playwright config from playwright.config.ts, run via
// `pnpm e2e:captcha`, never by `pnpm e2e`.
//
// Why separate: webServer env is config-global, and this lane needs the api booted with
// SETU_CAPTCHA_PROVIDER=turnstile while the main lane deliberately stays captcha-off. It also
// talks to real Cloudflare endpoints (the widget script from challenges.cloudflare.com and the
// server-side siteverify call), so unlike the hermetic main lane it can flake on external
// network. It therefore rides the existing optional-lane pattern: CI runs it on the full scope
// (push-to-main + weekly cron, next to E2E_FULL_MATRIX) and not in the per-PR path — see
// .github/workflows/ci.yml's "Run E2E" step.
//
// The keys are Cloudflare's PERMANENT PUBLIC Turnstile dummies (verified at
// developers.cloudflare.com/turnstile/troubleshooting/testing, 2026-07-25). They work on any
// domain including localhost, auto-resolve every challenge, and are documentation values — no
// secrets are being committed here.
//
// Two server pairs, because the secret is a boot-time config:
//   pass  (api :4447 / admin :5176) — always-pass sitekey + ALWAYS-PASS secret. Proves the happy
//         path: widget gates the submit, token threads through, siteverify accepts.
//   fail  (api :4449 / admin :5177) — the SAME always-pass sitekey (the widget must still issue a
//         token) + the ALWAYS-FAIL secret. The kill-shot built into the lane: the UI does
//         everything right and the server must still reject — which it can only do by genuinely
//         sending the token to siteverify. If the api ever stopped validating tokens, the pass
//         specs would keep passing trivially and THESE specs would fail.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

export const PASS_API_PORT = 4447
export const PASS_ADMIN_PORT = 5176
export const FAIL_API_PORT = 4449
export const FAIL_ADMIN_PORT = 5177

const passApiUrl = `http://localhost:${PASS_API_PORT}`
const passAdminUrl = `http://localhost:${PASS_ADMIN_PORT}`
const failApiUrl = `http://localhost:${FAIL_API_PORT}`
const failAdminUrl = `http://localhost:${FAIL_ADMIN_PORT}`

// Turnstile public dummy keys (single source in-repo: apps/api/src/captcha-test-keys.ts, which
// the api uses to make a test-key boot loudly visible — the values here must stay in that list
// or the boot line stops warning).
const SITEKEY_ALWAYS_PASS = '1x00000000000000000000AA'
const SECRET_ALWAYS_PASS = '1x0000000000000000000000000000000AA'
const SECRET_ALWAYS_FAIL = '2x0000000000000000000000000000000AA'

/** Env shared by both api instances; only the Turnstile secret differs. */
function apiEnv(opts: {
  apiPort: number
  adminUrl: string
  sandbox: string
  turnstileSecret: string
}) {
  return {
    // Same topology declaration rationale as playwright.config.ts (#643).
    SETU_MODE: 'local',
    SETU_API_PORT: String(opts.apiPort),
    SETU_REPO_DIR: path.join(repoRoot, '.content-sandbox', opts.sandbox),
    SETU_MEDIA_DIR: path.join(repoRoot, '.setu', `${opts.sandbox}-uploads`),
    // CORS/origin allowlist must name the real admin origin (see playwright.config.ts).
    SETU_ADMIN_ORIGIN: opts.adminUrl,
    // Deterministic auth lane (same as the main config): these specs sign in repeatedly and
    // Better Auth's /sign-in/email limit (3/10s) shares one loopback bucket.
    SETU_AUTH_RATELIMIT_ENABLED: 'false',
    // The lane's whole point:
    SETU_CAPTCHA_PROVIDER: 'turnstile',
    SETU_TURNSTILE_SITE_KEY: SITEKEY_ALWAYS_PASS,
    SETU_TURNSTILE_SECRET: opts.turnstileSecret,
    // Email must report deliverable=true or the forgot-password card renders its honest
    // not-configured copy instead of the form this lane exists to exercise
    // (emailCapabilityFromEnv requires transport 'resend' + a from-address). The dummy Resend
    // key is intended never to be used: the pass-lane forgot spec submits an email with no
    // account (better-auth's enumeration-safe branch responds without sending) and the fail
    // lane is rejected by the captcha gate before the route runs. If a send ever DID fire, the
    // resend adapter would throw on the bogus key and surface as a visible error that fails the
    // spec — the guard is self-enforcing, not silent.
    SETU_EMAIL_ADAPTER: 'resend',
    SETU_FORMS_NOTIFY_FROM: 'Setu E2E <e2e@setu.test>',
    RESEND_API_KEY: 're_e2e_dummy_never_called'
  }
}

export default defineConfig({
  testDir: './specs-captcha',
  outputDir: path.join(__dirname, 'test-results-captcha'),
  // Seeds the password users into both sandboxes' auth DBs (no storage states to mint — every
  // spec in this lane exercises the signed-OUT surfaces, so there is no auth.setup project).
  globalSetup: './captcha-global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry even locally (two on CI): the widget script and siteverify are real Cloudflare
  // endpoints — the one lane where a retry is buying flake-absorption, not hiding a bug.
  retries: process.env.CI ? 2 : 1,
  reporter: [
    [
      'html',
      {
        open: 'never',
        outputFolder: path.join(__dirname, 'playwright-report-captcha')
      }
    ],
    ['line']
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'captcha-pass',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: passAdminUrl,
        // Explicitly signed out (#634 class): this lane has no setup project today, but pin the
        // empty state so a future setup dependency can't silently authenticate these specs.
        storageState: { cookies: [], origins: [] }
      },
      testMatch: '**/captcha-pass.spec.ts'
    },
    {
      name: 'captcha-fail',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: failAdminUrl,
        storageState: { cookies: [], origins: [] }
      },
      testMatch: '**/captcha-fail.spec.ts'
    }
  ],
  webServer: [
    {
      // Sandbox reset rides the webServer command (Playwright starts webServer BEFORE
      // globalSetup — see playwright.config.ts's citation).
      command: `node scripts/content-sandbox.mjs reset e2e-captcha && pnpm --filter @setu/api dev`,
      url: `${passApiUrl}/git/head`,
      cwd: repoRoot,
      env: apiEnv({
        apiPort: PASS_API_PORT,
        adminUrl: passAdminUrl,
        sandbox: 'e2e-captcha',
        turnstileSecret: SECRET_ALWAYS_PASS
      }),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: `pnpm --filter @setu/admin exec vite --port ${PASS_ADMIN_PORT} --strictPort`,
      url: passAdminUrl,
      cwd: repoRoot,
      env: {
        VITE_SETU_API: passApiUrl,
        VITE_SETU_SITE: 'http://localhost:4321',
        SETU_ADMIN_DEV_BADGE: 'off'
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    },
    {
      command: `node scripts/content-sandbox.mjs reset e2e-captcha-fail && pnpm --filter @setu/api dev`,
      url: `${failApiUrl}/git/head`,
      cwd: repoRoot,
      env: apiEnv({
        apiPort: FAIL_API_PORT,
        adminUrl: failAdminUrl,
        sandbox: 'e2e-captcha-fail',
        turnstileSecret: SECRET_ALWAYS_FAIL
      }),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    },
    {
      command: `pnpm --filter @setu/admin exec vite --port ${FAIL_ADMIN_PORT} --strictPort`,
      url: failAdminUrl,
      cwd: repoRoot,
      env: {
        VITE_SETU_API: failApiUrl,
        VITE_SETU_SITE: 'http://localhost:4321',
        SETU_ADMIN_DEV_BADGE: 'off'
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    }
  ]
})
