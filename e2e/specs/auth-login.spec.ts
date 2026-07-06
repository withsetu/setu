import { test, expect } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { E2E_USERS } from '../lib/seed-users'

// Start with NO stored session. This is the real, cross-origin (admin :5175 → api :4446) browser
// login — the exact CORS preflight + `Set-Cookie` path a regression (cf. rescue/248-cors-fix) would
// break and that no unit/integration test exercises. "Drove it in the running app" for auth means
// exactly this, not the local auto-owner shortcut.
test.use({ storageState: { cookies: [], origins: [] } })

test('a user signs in through the real login screen and lands on the dashboard', async ({ page }) => {
  const login = new LoginPage(page)
  const dashboard = new DashboardPage(page)

  await page.goto('/')
  await expect(login.heading).toBeVisible()

  await login.signIn(E2E_USERS.admin.email, E2E_USERS.admin.password)

  await expect(dashboard.heading).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
})
