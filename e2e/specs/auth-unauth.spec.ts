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
