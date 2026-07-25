import { test, expect } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'

// No stored session — prove the gate is real, not bypassed: a deep link to an in-app route must NOT
// render the app; it must hold the visitor at the login wall.
test.use({ storageState: { cookies: [], origins: [] } })

test('an unauthenticated visitor is held at the login wall', async ({
  page
}) => {
  const login = new LoginPage(page)

  await page.goto('/dashboard')

  await expect(login.heading).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dashboard' })
  ).toBeHidden()
})

// #500: the forgot-password entry is capability-aware. The e2e api runs the console email
// adapter with no from-address (playwright.config.ts sets neither SETU_EMAIL_ADAPTER nor
// SETU_FORMS_NOTIFY_FROM), so /api/capabilities reports email.deliverable=false — the honest
// path: the link must lead to the not-configured copy, never to an email form whose submit
// could only dead-end.
test('forgot password on an undeliverable-email deployment shows honest copy, not a dead form', async ({
  page
}) => {
  const login = new LoginPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()

  await login.forgotPassword.click()

  await expect(
    page.getByText(/password reset isn[’']t configured for this site/i)
  ).toBeVisible()
  // No email-entry step on this path.
  await expect(page.getByLabel('Email')).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Send reset link' })
  ).toBeHidden()

  // And the way back works.
  await login.backToSignIn.click()
  await expect(login.heading).toBeVisible()
  await expect(login.emailInput).toBeVisible()
})
