import { test, expect, type Page } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { E2E_USERS } from '../lib/seed-users'

// #868 captcha lane, FAIL half — the kill-shot built into the lane (see e2e/captcha.config.ts).
// The widget runs the ALWAYS-PASS sitekey (so the client does everything right: token issued,
// gate opens, token threaded), but the api verifies with the ALWAYS-FAIL secret — siteverify
// rejects every token. The ONLY way these specs pass is the server genuinely posting the token
// to siteverify and honoring the verdict: if the api stopped validating (captcha plugin dropped,
// verdict ignored), the correct credentials below would mint a real session / the reset request
// would report its uniform success, and both assertions here would fail loudly.

const WIDGET_TIMEOUT = 20_000

const challengeHint = (page: Page) =>
  page.getByText('Complete the challenge above to continue.')

test('sign-in with correct credentials is rejected when siteverify fails the token', async ({
  page
}) => {
  const login = new LoginPage(page)
  const dashboard = new DashboardPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()
  // Wait until the widget has actually issued its token — clicking earlier would test the
  // missing-header 400, not the server-side verdict on a real token.
  await expect(challengeHint(page)).toBeVisible()
  await expect(login.submit).toBeEnabled({ timeout: WIDGET_TIMEOUT })

  // CORRECT credentials on purpose (seeded by captcha-global-setup.ts): with a broken captcha
  // gate this becomes a successful login, and the not-visible assertion below fails.
  await login.signIn(E2E_USERS.admin.email, E2E_USERS.admin.password)

  // better-auth's captcha plugin 403s (VERIFICATION_FAILED) before the route runs; the login
  // screen maps any non-401/429 failure to this generic copy — and never to the wrong-password
  // copy, which is what a seeded-user 401 would surface if the gate were bypassed.
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Something went wrong signing in — please try again.'
    })
  ).toBeVisible({ timeout: 15_000 })
  await expect(dashboard.heading).not.toBeVisible()
})

test('forgot-password surfaces the server rejection and re-arms the widget', async ({
  page
}) => {
  const login = new LoginPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()
  await login.forgotPassword.click()
  await expect(page.getByText('Reset your password')).toBeVisible()

  await login.emailInput.fill('captcha-nobody-e2e@setu.test')

  const send = page.getByRole('button', { name: 'Send reset link' })
  await expect(challengeHint(page)).toBeVisible()
  await expect(send).toBeEnabled({ timeout: WIDGET_TIMEOUT })
  await send.click()

  // An honest, visible failure — never the uniform "we've sent a link" success copy (#847's
  // defect class: a rejected request must not be dressed as success).
  await expect(
    page.getByRole('alert').filter({
      hasText: "Couldn't send the reset email — please try again."
    })
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText('If an account exists for that email')
  ).not.toBeVisible()

  // #847 re-arm on a REAL widget: captcha tokens are single-use and the failed request consumed
  // this one, so the card resets the widget; the always-pass sitekey then auto-resolves again
  // and the gate re-opens for the retry the error copy invites. (The token-cleared/disabled
  // interval is asserted deterministically in apps/admin/test/login-screen.test.tsx — here the
  // widget's timing is Cloudflare's, so we assert only the re-armed end state.)
  await expect(send).toBeEnabled({ timeout: WIDGET_TIMEOUT })
})
