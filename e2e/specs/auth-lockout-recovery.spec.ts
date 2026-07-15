import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'

// #386 lockout-recovery journey. The e2e api runs in LOCAL topology (the `@setu/api` dev script
// pins SETU_MODE=local — see playwright.config.ts's webServer command), so it persists its
// loopback handshake URL to `<SETU_REPO_DIR>/.setu/handshake-url` at boot and rewrites it with a
// freshly rotated token on EVERY exchange. This spec proves the whole recovery loop end-to-end:
// sign in from the file's URL, hit the passwordless sign-out guard, sign out anyway, recover via
// the ROTATED link, and verify the consumed link no longer grants a session.
//
// Sanctioned exception to the UI-only assertion rule (same as lib/sandbox-git.ts): the journey is
// *about* the on-disk handshake file — a locked-out owner's only way back in — so reading that
// file directly is the point, not a shortcut.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
// SETU_REPO_DIR from playwright.config.ts's api webServer env.
const handshakeFile = path.join(
  repoRoot,
  '.content-sandbox',
  'e2e',
  '.setu',
  'handshake-url'
)

// This journey owns its session lifecycle end-to-end: it must start signed OUT (no shared admin
// storage state), and the session it creates/destroys lives only in this test's context — the
// seeded admin/author/maintainer states other specs load are never touched.
test.use({ storageState: { cookies: [], origins: [] } })

/** Current handshake URL from disk, or null while it doesn't exist yet. Trimmed — the api writes
 *  the URL with a trailing newline (apps/api/src/handshake-file.ts). */
function readHandshakeUrl(): string | null {
  try {
    return readFileSync(handshakeFile, 'utf-8').trim()
  } catch {
    return null
  }
}

/** The local owner's display label, mirrored from the api's resolveGitIdentity()
 *  (apps/api/src/auth/git-identity.ts): `git config user.name`, falling back to 'Owner'. The
 *  owner account is minted from the git identity of the machine running the api (ensureLocalOwner),
 *  so the UserMenu trigger's accessible name is machine-dependent — compute it the same way the
 *  api does. cwd = repoRoot, the api webServer's own cwd, so config resolution matches. */
function localOwnerLabel(): string {
  try {
    const out = execFileSync('git', ['config', 'user.name'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return out === '' ? 'Owner' : out
  } catch {
    return 'Owner'
  }
}

/** The vite-dev-only "Reset to sample content" floating button overlaps the sidebar-footer user
 *  menu and intercepts its pointer events. It is `import.meta.env.DEV`-gated (dead-code-eliminated
 *  from real builds), so hiding it costs nothing in product coverage — same file-local helper and
 *  rationale as users-rank.spec.ts. */
async function hideDevReset(page: Page) {
  await page.addStyleTag({
    content: '.dev-reset { display: none !important; }'
  })
}

/** Navigate to a handshake URL with a guaranteed FULL page load. SessionGate consumes the
 *  `#setu-token` hash once per MOUNT (apps/admin/src/auth/SessionGate.tsx's exchange effect runs
 *  with an exchangeStarted ref + empty deps) — a hash-only same-document navigation from the
 *  login screen would never remount it, and the token would never be exchanged. */
async function gotoHandshakeUrl(page: Page, url: string) {
  await page.goto('about:blank')
  await page.goto(url)
}

// Chromium-only: the journey CONSUMES rotating single-use handshake tokens and asserts on the one
// shared on-disk handshake file. In the nightly full matrix (E2E_FULL_MATRIX=1), firefox-full and
// webkit-full also match `**/*.spec.ts` and run fullyParallel — two projects racing the same
// rotating file would invalidate each other's tokens mid-journey: flake by design, not a bug.
// Same single-project convention as users-rank.spec.ts's shared-seeded-user test.
test('#386: a passwordless local owner recovers from sign-out via the rotated handshake link', async ({
  page,
  browser
}) => {
  test.skip(
    test.info().project.name !== 'chromium',
    'consumes rotating single-use handshake tokens from one shared file — single-project only'
  )
  // Four full page loads, two of them cold-context Bootstrap boots (IDB + content-index
  // rebuild) — the same genuinely-cold paths author-draft.spec.ts gives explicit margin.
  test.setTimeout(60_000)

  const login = new LoginPage(page)
  const dashboard = new DashboardPage(page)

  let bootUrl = ''
  await test.step('sign in as the local owner via the persisted handshake URL', async () => {
    // Written synchronously right after the api starts listening; poll defensively anyway.
    await expect.poll(readHandshakeUrl).not.toBeNull()
    bootUrl = readHandshakeUrl()!
    expect(bootUrl).toContain('#setu-token=')

    await gotoHandshakeUrl(page, bootUrl)
    // Cold context: fresh IDB + content-index rebuild before the shell renders.
    await expect(dashboard.heading).toBeVisible({ timeout: 20_000 })
  })

  await test.step('sign-out is guarded: the passwordless AlertDialog offers all three actions', async () => {
    await hideDevReset(page)
    await page.getByRole('button', { name: localOwnerLabel() }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()

    const guard = page.getByRole('alertdialog', {
      name: 'Set a password before signing out?'
    })
    await expect(guard).toBeVisible()
    await expect(guard.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(
      guard.getByRole('button', { name: 'Set password' })
    ).toBeVisible()
    await expect(
      guard.getByRole('button', { name: 'Sign out anyway' })
    ).toBeVisible()
  })

  await test.step('"Sign out anyway" lands on the login screen with the local recovery hint', async () => {
    await page.getByRole('button', { name: 'Sign out anyway' }).click()
    await expect(login.heading).toBeVisible()
    // #386: the local-mode LoginScreen points a locked-out owner at the recovery command.
    await expect(page.getByText('pnpm auth:login-link')).toBeVisible()
  })

  let rotatedUrl = ''
  await test.step('the handshake file rotated on consumption; the new link signs the owner back in', async () => {
    // The step-1 exchange rotated the token and rewrote the file synchronously server-side
    // long before this point — the poll is belt-and-braces against fs timing, not a real race.
    await expect
      .poll(readHandshakeUrl, {
        message: 'handshake file should hold a rotated URL after consumption'
      })
      .not.toBe(bootUrl)
    rotatedUrl = readHandshakeUrl()!
    expect(rotatedUrl).toContain('#setu-token=')

    await gotoHandshakeUrl(page, rotatedUrl)
    await expect(dashboard.heading).toBeVisible({ timeout: 20_000 })
  })

  await test.step('the consumed boot link grants no session in a fresh browser context', async () => {
    // browser.newContext() ignores test.use fixtures — a genuinely fresh, cookie-less context.
    const freshContext = await browser.newContext()
    try {
      const freshPage = await freshContext.newPage()
      await freshPage.goto(bootUrl)
      // The exchange 401s (token consumed + rotated away), so SessionGate falls through to
      // the login wall — no dashboard, no session.
      await expect(new LoginPage(freshPage).heading).toBeVisible()
      await expect(new DashboardPage(freshPage).heading).not.toBeVisible()
    } finally {
      await freshContext.close()
    }
  })
})
