import { openSqliteDb } from '@setu/db-sqlite'
import { openInternalAuthContext } from '@setu/auth'

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
  // #811: the roles ladder is admin > maintainer > editor > author, and `editor` was the one rung
  // with no session anywhere in the harness — so nothing proved an editor CAN publish (the
  // capability that separates them from an author) or CANNOT reach `users.*`. A permission-matrix
  // edit collapsing editor into author, or promoting it toward maintainer, was invisible to e2e in
  // both directions. `auth.setup.ts` loops over every key here, so this one entry mints the
  // storage state too. Asserted both ways in auth-editor-rung.spec.ts.
  editor: {
    email: 'editor-e2e@setu.test',
    name: 'E2E Editor',
    role: 'editor',
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
  // Shared host-side bootstrap (same one apps/api's reset-password script uses) — the throwaway
  // secret/baseURL rationale lives on openInternalAuthContext itself.
  const ctx = await openInternalAuthContext(openSqliteDb(dbFile))
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
