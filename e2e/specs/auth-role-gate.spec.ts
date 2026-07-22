import { test, expect } from '@playwright/test'
import { DashboardPage } from '../pages/DashboardPage'
import { storageStateFor } from '../lib/auth-state'

// Signed in as a real `author` session (seeded + logged in through the UI in auth.setup.ts). An
// author holds content.* but NOT `users.view` — so the admin-only Users surface must be denied in
// the nav AND on a direct deep link.
//
// #810: BOTH assertions below are UX, not security. `useCan()` hides the nav link and `RequireCan`
// bounces the route, but both are client-side React — a caller who never loads the SPA is
// unaffected by either, so neither one is a security boundary (CLAUDE.md §1: "UI `useCan()` is UX,
// not security"; §4 #13 "The UI-Only Gate"). The header comment here previously called `RequireCan`
// "the real security boundary", which is exactly the class of claim §4 #21 forbids: it sits where
// the next reader goes to check whether the server half is covered, and told them it was.
//
// The SERVER half — `GET /api/users` gated on `users.view` in apps/api/src/users.ts — is asserted
// separately, against the running api with this same author session, in
// publish-and-users-gate.spec.ts, with a recorded kill-shot. What this spec proves is that the
// admin never OFFERS or RENDERS the screen to an author; what that spec proves is that the data is
// unreachable even when the UI is bypassed entirely.
//
// This is still the regression proof for the role matrix's UI half: loosen the gate and this goes
// RED (see the PR's documented before/after).
test.use({ storageState: storageStateFor('author') })

test('an author is denied the admin-only Users screen', async ({ page }) => {
  const dashboard = new DashboardPage(page)

  await page.goto('/dashboard')
  await expect(dashboard.heading).toBeVisible()

  // (1) The nav never offers Users to an author (`useCan` — UX).
  await expect(page.getByRole('link', { name: 'Users' })).toBeHidden()

  // (2) A direct deep link is bounced back to the dashboard by the `RequireCan` route guard, so
  //     the Users screen never renders for an author. Also UX: this is client-side React routing,
  //     and the roster it would have fetched is what the server gate actually protects.
  await page.goto('/users')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(dashboard.heading).toBeVisible()
})
