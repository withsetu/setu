import { test, expect } from '@playwright/test'
import { DashboardPage } from '../pages/DashboardPage'

test('admin dashboard renders at /', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  await page.goto('/')

  // `/` redirects to `/dashboard`; PageHeader renders the screen title as an h1.
  await expect(dashboard.heading).toBeVisible()

  // AppSidebar nav — a known, always-present entry point into the app shell.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
})
