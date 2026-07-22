import { test, expect } from '@playwright/test'
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
    // Single-project only: unlike the invite/disable tests (whose invited users are
    // project-unique via uniqueTitle's project-name + random token, so every project safely
    // works on its own row), this test mutates the ONE shared seeded maintainer. In the nightly
    // full matrix (E2E_FULL_MATRIX=1), chromium + firefox-full + webkit-full all match this spec
    // and run fullyParallel — concurrent renames of the same backend user would clobber each
    // other's assertions.
    test.skip(
      test.info().project.name !== 'chromium',
      'mutates the shared seeded maintainer — single-project only'
    )

    await page.goto('/dashboard')
    const newName = `Renamed Maintainer ${uniqueTitle('profile-rename').split(' ').pop()}`

    // The seeded name MUST be restored no matter which assertion below fails — seedUsers only
    // creates missing users (it never repairs an existing row), so a failure that skipped the
    // rename-back would leave the shared maintainer permanently renamed for every later run.
    // Same finally-guarded-cleanup shape as author-draft.spec.ts's second browser context.
    try {
      await page.getByRole('button', { name: 'E2E Maintainer' }).click()
      await page.getByRole('menuitem', { name: 'Your profile' }).click()
      const profileDialog = page.getByRole('dialog', { name: 'Your profile' })
      await profileDialog.getByLabel('Display name').fill(newName)
      await profileDialog.getByRole('button', { name: 'Save' }).click()
      await expect(profileDialog).toBeHidden()

      // The sidebar footer re-renders from the live session, no reload needed.
      await expect(page.getByRole('button', { name: newName })).toBeVisible()
    } finally {
      // Resilient restore: start from a fresh page load rather than whatever half-state the
      // body failed in (dialog possibly still open, menu possibly still open). The user-menu
      // button's accessible name is the CURRENT display name — which is `newName` after a
      // successful rename but still `E2E Maintainer` if the body failed before saving — so
      // match either. Re-saving the same name is a harmless no-op in the not-yet-renamed case.
      await page.goto('/dashboard')
      await page
        .getByRole('button', {
          name: new RegExp(`^(E2E Maintainer|${newName})$`)
        })
        .click()
      await page.getByRole('menuitem', { name: 'Your profile' }).click()
      const restoreDialog = page.getByRole('dialog', { name: 'Your profile' })
      await restoreDialog.getByLabel('Display name').fill('E2E Maintainer')
      await restoreDialog.getByRole('button', { name: 'Save' }).click()
      await expect(restoreDialog).toBeHidden()
      await expect(
        page.getByRole('button', { name: 'E2E Maintainer' })
      ).toBeVisible()
    }
  })

  // ## Kill-shot for the #812 tightening below (CLAUDE.md §3.3 #4) — recorded 2026-07-21, chromium
  //
  // Both rank-guard hooks in packages/auth/src/rank-guard.ts were short-circuited (an early
  // `return` at the top of `rankGuardCreateHook`'s and `rankGuardUpdateHook`'s returned
  // functions), the spec proven RED, then restored and re-run green:
  //     ✘ wrong-actor API: the better-auth admin routes reject a maintainer acting at/above
  //       their own rank
  //       Error: maintainer set-role on an admin        Expected: 403 / Received: 400
  //       Error: maintainer create-user role=admin      Expected: 403 / Received: 200
  //       Error: the rejected create-user must not have created the account
  //         Expected value: not "chromium-users-rank-api-reject-vfstia@setu.test"
  //         Received array: [admin-e2e@, author-e2e@, editor-e2e@, maintainer-e2e@,
  //                          chromium-users-rank-api-reject-vfstia@setu.test]
  //
  // The set-role line is the whole reason #812 was filed: with the rank guard GONE, that call
  // still came back 400 — from the separate last-admin guard, which independently refuses to
  // demote the only active admin — so the old `>= 400 && < 500` band PASSED against a build with
  // no rank guard at all. The exact-status assertion is what turns that into a failure.
  //
  // Honest limit of the state controls: for the same reason, "the admin's role is unchanged"
  // stayed GREEN under this sabotage — the last-admin guard, not the rank guard, is what kept the
  // demotion from landing. It is the create-user control that catches the breach, and it did. The
  // role check is still worth keeping: it covers the case where a rank-guard regression coincides
  // with a target that is NOT the last admin.
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
      users: { id: string; email: string; role: string | null }[]
    }
    const admin = users.find((u) => u.email === 'admin-e2e@setu.test')
    expect(admin).toBeTruthy()
    expect(admin!.role).toBe('admin')

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
    // #812: this used to assert only `>= 400 && < 500`, which ANY 4xx satisfies — a 404 if
    // better-auth relocates `/admin/set-role`, a 401 if the maintainer session expires, a 400
    // from payload-shape drift. Each is coverage rot that reports as a working rank guard
    // forever. Pin the exact status AND the guard's own message instead, so the assertion can
    // only pass when THIS guard is what rejected the call: `rank-guard.ts`'s `forbidden()` throws
    // better-call's `APIError('FORBIDDEN', { message })`, and `toResponse` serializes an APIError
    // as `statusCode` + the `body` object verbatim (better-call 1.3.7's to-response.mjs), so the
    // wire shape is 403 + `{ message }`.
    expect(setRoleRes.status(), 'maintainer set-role on an admin').toBe(403)
    expect((await setRoleRes.json()) as unknown).toMatchObject({
      message: 'cannot manage a user at or above your own rank'
    })

    // rank-guard.ts's rankGuardCreateHook: a maintainer may never hand out a role at/above their
    // own rank, even via the direct better-auth route the UI's InviteUserDialog never offers.
    const rejectedEmail = uniqueEmail('users-rank-api-reject')
    const createUserRes = await page.request.post(
      `${apiUrl}/api/auth/admin/create-user`,
      {
        headers: { origin: adminOrigin },
        data: {
          email: rejectedEmail,
          password: 'e2e-Password-123456',
          name: 'Should Not Be Created',
          role: 'admin'
        }
      }
    )
    expect(createUserRes.status(), 'maintainer create-user role=admin').toBe(
      403
    )
    expect((await createUserRes.json()) as unknown).toMatchObject({
      message: 'cannot assign a role at or above your own rank'
    })

    // #812 state control — the half that was missing entirely. A status code says the response
    // was a rejection; it does not say the MUTATION didn't land. `git-path-canonical-gate.spec.
    // ts:114-118` insists on exactly this distinction ("not merely that a status code came back,
    // but that NO write landed") and this spec was inconsistent with the suite's own strongest
    // rule. Re-read the real roster and assert both attempted mutations are absent from it.
    const afterRes = await page.request.get(`${apiUrl}/api/users`, {
      headers: { origin: adminOrigin }
    })
    expect(afterRes.ok()).toBe(true)
    const { users: after } = (await afterRes.json()) as {
      users: { id: string; email: string; role: string | null }[]
    }
    // The demotion never happened: the admin is still an admin.
    expect(
      after.find((u) => u.email === 'admin-e2e@setu.test')?.role,
      'the rejected set-role must not have demoted the admin'
    ).toBe('admin')
    // The peer-rank account was never created. `rejectedEmail` is uniqueTitle-derived, so its
    // absence is unambiguous — no other project or re-run could have created or removed it.
    expect(
      after.map((u) => u.email),
      'the rejected create-user must not have created the account'
    ).not.toContain(rejectedEmail)
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
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' })
    ).toBeVisible()

    await page.getByRole('button', { name: 'E2E Author' }).click()
    await expect(
      page.getByRole('menuitem', { name: 'Your profile' })
    ).toBeVisible()
  })
})
