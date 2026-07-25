import { test, expect, type Page } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { E2E_USERS } from '../lib/seed-users'

// #868 captcha lane, PASS half (see e2e/captcha.config.ts for the lane design): the api runs
// Turnstile with Cloudflare's public always-pass test pair, so the real widget renders on the
// login surfaces, issues a real (dummy-format) token, and the server's siteverify call accepts
// it. Together with captcha-fail.spec.ts this proves the token is genuinely threaded end-to-end:
// this half would fail if the client stopped sending the token (submit gated / server 400s), the
// fail half would fail if the server stopped validating it.

// The widget script loads from challenges.cloudflare.com — give the token waits real headroom.
const WIDGET_TIMEOUT = 20_000

/** Both login-flow cards render this hint exactly while a captcha is configured and no token has
 *  been issued yet (LoginScreen.tsx's `captchaPending`). */
const challengeHint = (page: Page) =>
  page.getByText('Complete the challenge above to continue.')

test('submits stay gated when the widget cannot issue a token', async ({
  page
}) => {
  // Hermetic gate proof: block the widget script entirely so no token can EVER arrive, then
  // assert both cards hold their submits shut. This is the deterministic half of the gating
  // story — the happy-path specs below prove the gate OPENS, but their pre-token "disabled"
  // window depends on CDN timing, so the fail-closed assertion lives here where it can't race.
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.abort()
  )
  const login = new LoginPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()
  await expect(challengeHint(page)).toBeVisible()
  await expect(login.submit).toBeDisabled()

  await login.forgotPassword.click()
  await expect(page.getByText('Reset your password')).toBeVisible()
  await expect(challengeHint(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send reset link' })
  ).toBeDisabled()
})

test('sign-in succeeds once the widget issues a token', async ({ page }) => {
  const login = new LoginPage(page)
  const dashboard = new DashboardPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()
  // Capabilities announced the captcha (hint shows while the token is pending)…
  await expect(challengeHint(page)).toBeVisible()
  // …then the always-pass widget resolves and re-opens the gate.
  await expect(login.submit).toBeEnabled({ timeout: WIDGET_TIMEOUT })

  await login.signIn(E2E_USERS.admin.email, E2E_USERS.admin.password)
  // A session only exists if the api accepted the token at siteverify — with a captcha
  // configured, better-auth 400s any /sign-in/email missing a valid x-captcha-response.
  await expect(dashboard.heading).toBeVisible({ timeout: 15_000 })
})

test('forgot-password is gated until the widget issues a token, then succeeds', async ({
  page
}) => {
  const login = new LoginPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()
  await login.forgotPassword.click()
  await expect(page.getByText('Reset your password')).toBeVisible()

  // No account exists for this address on purpose: better-auth's /request-password-reset
  // answers its uniform enumeration-safe success without sending anything, so the spec never
  // depends on a real email transport (see the RESEND_API_KEY note in captcha.config.ts).
  await login.emailInput.fill('captcha-nobody-e2e@setu.test')

  const send = page.getByRole('button', { name: 'Send reset link' })
  await expect(challengeHint(page)).toBeVisible()
  await expect(send).toBeEnabled({ timeout: WIDGET_TIMEOUT })
  await send.click()

  // The captcha-gated route accepted the token (always-pass secret) and the card swapped to its
  // uniform sent copy.
  await expect(
    page.getByText('If an account exists for that email')
  ).toBeVisible({ timeout: 15_000 })
})
