import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { test as setup, expect } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { seedUsers, E2E_USERS, type E2ERole } from '../lib/seed-users'
import { authDir, storageStateFor } from '../lib/auth-state'

const dirname = path.dirname(fileURLToPath(import.meta.url))
// The api opened SETU_SUBMISSIONS_DB = <SETU_REPO_DIR>/.setu/submissions.db, and
// playwright.config.ts sets SETU_REPO_DIR = <repoRoot>/.content-sandbox/e2e.
const repoRoot = path.resolve(dirname, '..', '..')
const dbFile = path.join(repoRoot, '.content-sandbox', 'e2e', '.setu', 'submissions.db')

// Serial: the seed MUST finish before either login runs (they sign in as the seeded users).
setup.describe.configure({ mode: 'serial' })

setup('seed password users', async () => {
  mkdirSync(authDir, { recursive: true })
  await seedUsers(dbFile)
})

for (const role of Object.keys(E2E_USERS) as E2ERole[]) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const login = new LoginPage(page)
    const dashboard = new DashboardPage(page)

    await page.goto('/')
    await expect(login.heading).toBeVisible()

    await login.signIn(E2E_USERS[role].email, E2E_USERS[role].password)

    // A real session now exists — SessionGate swaps the login screen for the app shell.
    await expect(dashboard.heading).toBeVisible()
    await page.context().storageState({ path: storageStateFor(role) })
  })
}
