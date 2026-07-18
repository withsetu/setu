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

/** #604: the At-a-glance status tiles count posts AND pages, so they now open
 *  /content — the cross-collection list — instead of /posts, which could only
 *  ever show half of what the tile counted (UAT: Staged said 19, the list showed
 *  5, with 14 staged pages unreachable).
 *
 *  This crosses the seam the unit tests can't: the admin's index client omitting
 *  `collection`, the API's Zod boundary accepting that as the all-collections
 *  scope, and the list screen rendering the mixed result. The exact
 *  tile-number === list-number equality is asserted in apps/admin's
 *  stat-tiles.test.tsx against the real query engine — deliberately NOT here,
 *  because publish.spec.ts commits to the same shared sandbox concurrently and a
 *  cross-navigation count comparison would flake on it. */
test('the Drafts tile opens a list that spans posts and pages (#604)', async ({
  page
}) => {
  await page.goto('/dashboard')

  const drafts = page.getByRole('link', { name: /Drafts/ })
  await expect(drafts).toBeVisible()
  // #611: draft + unpublished — the tile counts both, so the filter must too.
  await expect(drafts).toHaveAttribute('href', '/content?status=not-published')

  await page.goto('/content')
  await expect(
    page.getByRole('heading', { level: 1, name: /All content/ })
  ).toBeVisible()

  // The proof it is genuinely cross-collection: the Type column carries more
  // than one collection. /posts or /pages can never produce this.
  const types = page.locator('table tbody tr td:nth-child(3)')
  await expect(types.first()).toBeVisible()
  const seen = new Set(
    (await types.allTextContents()).map((t) => t.trim()).filter(Boolean)
  )
  expect([...seen].sort()).toEqual(['page', 'post'])
})
