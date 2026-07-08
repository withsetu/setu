import { test, expect } from '@playwright/test'
import { DashboardPage } from '../pages/DashboardPage'
import { storageStateFor } from '../lib/auth-state'

// Signed in as a real `author` session (seeded + logged in through the UI in auth.setup.ts). An
// author holds content.* but NOT `users.view` — so the admin-only Users surface must be denied both
// in the nav (UX) and on a direct deep link (the `RequireCan` route guard, the real security
// boundary). This is the regression proof for the role matrix: loosen the gate and this goes RED
// (see the PR's documented before/after).
test.use({ storageState: storageStateFor('author') })

test('an author is denied the admin-only Users screen', async ({ page }) => {
  const dashboard = new DashboardPage(page)

  await page.goto('/dashboard')
  await expect(dashboard.heading).toBeVisible()

  // (1) The nav never offers Users to an author.
  await expect(page.getByRole('link', { name: 'Users' })).toBeHidden()

  // (2) A direct deep link is bounced back to the dashboard by RequireCan — the Users screen
  //     never renders for an author.
  await page.goto('/users')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(dashboard.heading).toBeVisible()
})
