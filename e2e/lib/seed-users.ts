import { openSqliteDb } from '@setu/db-sqlite'
import { createAuth } from '@setu/auth'

/** The password test users the e2e auth harness signs in as.
 *
 *  Seeded server-side through Better Auth's own `internalAdapter.createUser` + `linkAccount`
 *  (`providerId: 'credential'`) — the EXACT path apps/api's admin-invite and `ensureLocalOwner`
 *  use. This is not a hand-forged session or a raw DB row: passwords are hashed with Better Auth's
 *  own scrypt (which is secret-independent), so the running api verifies them at
 *  `/sign-in/email` unchanged, and the harness then logs in through the real UI. */
export const E2E_USERS = {
  admin: {
    email: 'admin-e2e@setu.test',
    name: 'E2E Admin',
    role: 'admin',
    password: 'e2e-Password-123456'
  },
  author: {
    email: 'author-e2e@setu.test',
    name: 'E2E Author',
    role: 'author',
    password: 'e2e-Password-123456'
  },
  // #364: the below-rank-management + rank-gate-parity e2e (users-rank.spec.ts) needs a real
  // maintainer session — maintainer outranks editor/author but not admin, the exact middle rung
  // the rank guard exists to enforce.
  maintainer: {
    email: 'maintainer-e2e@setu.test',
    name: 'E2E Maintainer',
    role: 'maintainer',
    password: 'e2e-Password-123456'
  }
} as const

export type E2ERole = keyof typeof E2E_USERS

/** Idempotently create the e2e password users in the api's own sqlite auth db — the file the
 *  running `@setu/api` process opened as `SETU_SUBMISSIONS_DB` (`<SETU_REPO_DIR>/.setu/
 *  submissions.db`), reached via the shared `openSqliteDb` seam (same handle + migrations
 *  `createAuth` itself uses). Safe to call on every run: users that already exist are left
 *  untouched. Runs during Playwright's setup project, when the api is up but idle. */
export async function seedUsers(dbFile: string): Promise<void> {
  const db = openSqliteDb(dbFile)
  // secret/baseURL/trustedOrigins are required by createAuth but irrelevant here: we only touch
  // internalAdapter (user rows) + password.hash (scrypt), neither of which signs a session.
  const auth = createAuth({
    db,
    secret: 'e2e-seed-only-never-signs-a-session',
    baseURL: 'http://localhost:4446',
    trustedOrigins: ['http://localhost:5175']
  })
  const ctx = await auth.$context
  for (const u of Object.values(E2E_USERS)) {
    if (await ctx.internalAdapter.findUserByEmail(u.email)) continue
    const user = await ctx.internalAdapter.createUser({
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: true
    })
    const password = await ctx.password.hash(u.password)
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password
    })
  }
}
