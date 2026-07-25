// #868 captcha lane globalSetup: seed the password users into BOTH captcha sandboxes' auth DBs.
//
// Runs AFTER the webServer processes are healthy (same playwright sequencing citation as
// e2e/global-setup.ts), so each api has already booted and created its
// `<SETU_REPO_DIR>/.setu/submissions.db` — seedUsers opens that same file directly, exactly like
// specs/auth.setup.ts does for the main lane. Both sandboxes get seeded:
//   - e2e-captcha (pass lane): the sign-in happy path logs in as the seeded admin.
//   - e2e-captcha-fail (fail lane): the sign-in negative uses CORRECT credentials on purpose —
//     if captcha enforcement ever silently vanished, that spec would turn into a successful
//     login and fail loudly on "dashboard must not be visible".
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedUsers } from './lib/seed-users'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

export default async function globalSetup() {
  for (const sandbox of ['e2e-captcha', 'e2e-captcha-fail']) {
    await seedUsers(
      path.join(
        repoRoot,
        '.content-sandbox',
        sandbox,
        '.setu',
        'submissions.db'
      )
    )
  }
}
