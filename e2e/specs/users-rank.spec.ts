import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { storageStateFor } from '../lib/auth-state'
import { uniqueTitle } from '../lib/unique-title'

// The api's real, cross-origin admin auth surface (admin :5175 -> api :4446) — same ports
// playwright.config.ts hardcodes for the whole e2e run.
const apiUrl = 'http://localhost:4446'
const adminOrigin = 'http://localhost:5175'

/** Unique, e2e-safe email for an invited user (chromium + webkit share one sandbox, so no two
 *  projects/re-runs may ever collide on the same address) — same concurrency rationale as
 *  `uniqueTitle`, just slugified into something RFC-5321-friendly. */
function uniqueEmail(label: string): string {
  const token = uniqueTitle(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
  return `${token}@setu.test`
}

/** `main.tsx`'s `DevReset` ("Reset to sample content") is dev-only harness scaffolding
 *  (`import.meta.env.DEV`-gated, compiled out of production builds — never a product surface)
 *  fixed at bottom-left, the exact corner the sidebar footer's user-menu button also sits in.
 *  `a11y.spec.ts` already excludes it from its scans for the same reason; hiding it here before
 *  clicking that button is the same call — it costs nothing in product coverage since a real,
 *  built app never renders it. */
async function hideDevReset(page: Page) {
  await page.addStyleTag({
    content: '.dev-reset { display: none !important; }'
  })
}

// #364: a maintainer (rank 3) may invite/manage editor+author (below them) but never a peer
// maintainer or an admin; #410: any signed-in role can rename themselves via the sidebar
// "Your profile" dialog. Serial: steps 2-4 read the row the invite in step 1 created, and a real
// backend user survives across tests within this file regardless of test isolation.
test.describe('maintainer below-rank user management + rank gate parity (#364, #410)', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: storageStateFor('maintainer') })

  // Assigned inside the first test (uniqueTitle needs a running test's test.info(), so this
  // can't be computed at module/describe-body init time) and read by every later test in this
  // serial run — always "the just-invited editor", never a seeded admin/author/maintainer row.
  let invitedEmail: string
  let invitedName: string

  test('right-actor: maintainer invites a below-rank editor, the row appears, and can be disabled/re-enabled', async ({
    page
  }) => {
    invitedEmail = uniqueEmail('users-rank-editor')
    invitedName = `Rank Editor ${invitedEmail.split('@')[0]}`

    await page.goto('/users')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Users & Roles' })
    ).toBeVisible()

    await page.getByRole('button', { name: 'Add user' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add user' })
    await dialog.getByLabel('Name').fill(invitedName)
    await dialog.getByLabel('Email').fill(invitedEmail)
    await dialog.getByLabel('Temporary password').fill('e2e-Password-123456')

    // #364: the role picker offers only roles strictly below the maintainer's own rank — Editor
    // and Author, never Maintainer (a peer) or Admin. The Select's content portals to
    // document.body (outside the dialog's own DOM subtree), so these are page-scoped, not
    // dialog-scoped.
    await dialog.getByLabel('Role').click()
    const roleOptionTexts = await page.getByRole('option').allTextContents()
    expect(roleOptionTexts).toHaveLength(2)
    expect(roleOptionTexts.some((t) => /^editor/i.test(t))).toBe(true)
    expect(roleOptionTexts.some((t) => /^author/i.test(t))).toBe(true)
    expect(roleOptionTexts.some((t) => /maintainer/i.test(t))).toBe(false)
    expect(roleOptionTexts.some((t) => /^admin/i.test(t))).toBe(false)
    await page.getByRole('option', { name: /^editor/i }).click()

    await dialog.getByRole('button', { name: 'Add user' }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page
        .getByRole('region', { name: 'Notifications', exact: true })
        .getByText(`Invited ${invitedName}`)
    ).toBeVisible()

    const row = page.getByRole('row', { name: new RegExp(invitedEmail) })
    await expect(row).toBeVisible()
    // The row-action role-change Select shows the current value as its trigger text.
    await expect(row.getByRole('combobox')).toHaveText(/editor/i)

    // Disable the JUST-INVITED editor. Never the seeded author/admin/maintainer rows — this is
    // a shared sandbox and other specs log in as those users.
    await row
      .getByRole('button', { name: `More actions for ${invitedName}` })
      .click()
    await page.getByRole('menuitem', { name: 'Disable user' }).click()
    await page.getByRole('button', { name: 'Disable' }).click()
    await expect(row.getByText('Disabled')).toBeVisible()

    // Re-enable — no confirm step for this direction.
    await row
      .getByRole('button', { name: `More actions for ${invitedName}` })
      .click()
    await page.getByRole('menuitem', { name: 'Enable user' }).click()
    await expect(row.getByText('Active')).toBeVisible()
  })

  test("wrong-actor UI: the admin row + the maintainer's own row are read-only, and reset-email is honestly disabled", async ({
    page
  }) => {
    await page.goto('/users')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Users & Roles' })
    ).toBeVisible()

    // A maintainer never outranks an admin (or a peer maintainer) — canManageTarget hides the
    // whole row-actions surface, mirroring the server-side rank guard exactly. This is the
    // regression proof: weaken canManageTarget and this goes red (see the PR's red-proof note).
    const adminRow = page.getByRole('row', { name: /admin-e2e@setu\.test/ })
    await expect(adminRow).toBeVisible()
    await expect(adminRow.getByRole('combobox')).toHaveCount(0)
    await expect(
      adminRow.getByRole('button', { name: /more actions for/i })
    ).toHaveCount(0)

    const selfRow = page.getByRole('row', {
      name: /maintainer-e2e@setu\.test/
    })
    await expect(selfRow).toBeVisible()
    await expect(selfRow.getByRole('combobox')).toHaveCount(0)
    await expect(
      selfRow.getByRole('button', { name: /more actions for/i })
    ).toHaveCount(0)

    // The below-rank invited editor DOES get an actions menu, but "Send password reset email"
    // renders disabled with the honest capability tooltip: this e2e harness runs the api with
    // the console email transport (capabilities.ts: email.deliverable === false), so there is
    // truly no provider to send through — asserting a sent email here would be the wrong claim.
    const editorRow = page.getByRole('row', { name: new RegExp(invitedEmail) })
    await editorRow
      .getByRole('button', { name: `More actions for ${invitedName}` })
      .click()
    const resetItem = page.getByRole('menuitem', {
      name: 'Send password reset email'
    })
    await expect(resetItem).toHaveAttribute('aria-disabled', 'true')
    // GuardedTrigger renders a Radix Tooltip (delayDuration 0) around the disabled item, via a
    // `<span tabIndex={0}>` wrapper — the item itself is `pointer-events: none` (Tailwind's
    // `data-[disabled]:pointer-events-none`), specifically so hover lands on that wrapping span
    // instead (the same reason GuardedTrigger's own comment gives), so hover the span, not the
    // disabled item, or Playwright's real hit-testing reports the span as "intercepting".
    const resetTrigger = page
      .locator('[data-slot="tooltip-trigger"]')
      .filter({ has: resetItem })
    await resetTrigger.hover()
    await expect(page.getByText(/need an email provider/i)).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('#410: the maintainer renames themselves via the sidebar "Your profile" dialog', async ({
    page
  }) => {
    await page.goto('/dashboard')
    await hideDevReset(page)
    const newName = `Renamed Maintainer ${uniqueTitle('profile-rename').split(' ').pop()}`

    await page.getByRole('button', { name: 'E2E Maintainer' }).click()
    await page.getByRole('menuitem', { name: 'Your profile' }).click()
    const profileDialog = page.getByRole('dialog', { name: 'Your profile' })
    await profileDialog.getByLabel('Display name').fill(newName)
    await profileDialog.getByRole('button', { name: 'Save' }).click()
    await expect(profileDialog).toBeHidden()

    // The sidebar footer re-renders from the live session, no reload needed.
    await expect(page.getByRole('button', { name: newName })).toBeVisible()

    // Restore to the seeded name — no OTHER spec asserts on it (grepped the suite for "E2E
    // Maintainer"), but the shared sandbox stays canonical for whichever spec runs next.
    await page.getByRole('button', { name: newName }).click()
    await page.getByRole('menuitem', { name: 'Your profile' }).click()
    const restoreDialog = page.getByRole('dialog', { name: 'Your profile' })
    await restoreDialog.getByLabel('Display name').fill('E2E Maintainer')
    await restoreDialog.getByRole('button', { name: 'Save' }).click()
    await expect(restoreDialog).toBeHidden()
    await expect(
      page.getByRole('button', { name: 'E2E Maintainer' })
    ).toBeVisible()
  })

  test('wrong-actor API: the better-auth admin routes reject a maintainer acting at/above their own rank', async ({
    page
  }) => {
    // The real roster, read via the maintainer's own session cookies (page.request shares the
    // browser context's cookie jar) — Setu's own `/api/users` route, gated on `users.view`,
    // which a maintainer holds. Explicit `origin` header: better-auth's originCheckMiddleware
    // requires a trusted Origin whenever a cookie is present (verified against the installed
    // better-auth 1.6.23 source) — without it EVERY cookie-bearing POST 403s on
    // MISSING_OR_NULL_ORIGIN regardless of rank, which would prove the wrong thing. Setting it
    // to the real admin origin makes the request reach the rank guard, which is what this test
    // means to exercise.
    const listRes = await page.request.get(`${apiUrl}/api/users`, {
      headers: { origin: adminOrigin }
    })
    expect(listRes.ok()).toBe(true)
    const { users } = (await listRes.json()) as {
      users: { id: string; email: string }[]
    }
    const admin = users.find((u) => u.email === 'admin-e2e@setu.test')
    expect(admin).toBeTruthy()

    // rank-guard.ts's rankGuardUpdateHook: a maintainer may only set-role a target strictly
    // below their own rank — an admin target is always rejected, regardless of the role handed
    // out.
    const setRoleRes = await page.request.post(
      `${apiUrl}/api/auth/admin/set-role`,
      {
        headers: { origin: adminOrigin },
        data: { userId: admin!.id, role: 'author' }
      }
    )
    expect(setRoleRes.status()).toBeGreaterThanOrEqual(400)
    expect(setRoleRes.status()).toBeLessThan(500)

    // rank-guard.ts's rankGuardCreateHook: a maintainer may never hand out a role at/above their
    // own rank, even via the direct better-auth route the UI's InviteUserDialog never offers.
    const createUserRes = await page.request.post(
      `${apiUrl}/api/auth/admin/create-user`,
      {
        headers: { origin: adminOrigin },
        data: {
          email: uniqueEmail('users-rank-api-reject'),
          password: 'e2e-Password-123456',
          name: 'Should Not Be Created',
          role: 'admin'
        }
      }
    )
    expect(createUserRes.status()).toBeGreaterThanOrEqual(400)
    expect(createUserRes.status()).toBeLessThan(500)
  })
})

// auth-role-gate.spec.ts already proves an author is denied the Users screen (nav-hidden AND
// deep-link-bounced) — this only adds the NEW #410 assertion: the self-profile entry point
// survives the `users.view` gate that hides the whole Users screen from an author.
test.describe('author keeps self-profile access despite no Users screen', () => {
  test.use({ storageState: storageStateFor('author') })

  test('an author still has "Your profile" in the sidebar menu', async ({
    page
  }) => {
    await page.goto('/dashboard')
    await hideDevReset(page)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' })
    ).toBeVisible()

    await page.getByRole('button', { name: 'E2E Author' }).click()
    await expect(
      page.getByRole('menuitem', { name: 'Your profile' })
    ).toBeVisible()
  })
})
