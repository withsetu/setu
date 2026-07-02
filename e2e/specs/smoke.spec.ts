import { test, expect } from '@playwright/test'

test('admin dashboard renders at /', async ({ page }) => {
  await page.goto('/')

  // `/` redirects to `/dashboard`; PageHeader renders the screen title as an h1.
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

  // AppSidebar nav — a known, always-present entry point into the app shell.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
})
