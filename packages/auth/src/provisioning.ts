import type { UserProvisioningSource } from '@better-auth/core'

/**
 * How each server-side user-creation path in Setu describes ITSELF to better-auth.
 *
 * better-auth 1.7 made `internalAdapter.createUser` take a second, required `source` argument and
 * feeds it — plus `action: 'create-user'` — to the `user.validateUserInfo` gate. The compiler only
 * forces that *an* argument is present; it cannot tell whether the argument is true. A path that
 * declares the wrong method puts a false statement inside an auth gate, which is the failure mode
 * of a comment that vouches for something the code does not do, except consumed by a security
 * check rather than by a reader. So the vocabulary lives here, in one reviewable table, rather
 * than as a literal at each call site.
 *
 * Setu does NOT install `validateUserInfo` today — a deliberate decision recorded on #1080, so
 * that a dependency migration does not smuggle in a new auth behaviour. These values are
 * therefore declarative only; they become load-bearing the moment a gate is added, which is
 * exactly why they must already be true.
 *
 * `ValidateUserInfoMethod` names better-auth's built-in methods and leaves the string open for
 * anything else ("for example `scim`"). Setu's server-side bootstraps are not any of the
 * built-ins — no one authenticated, an operator or a seeder asserted the account — so they take
 * namespaced `setu-*` values rather than borrowing a built-in name that would misdescribe them.
 * The one exception is the first-run setup route, which really does take an email and a password
 * from a human over HTTP and links a credential account with them.
 *
 * Which path declares which is asserted in packages/auth/test/provisioning.test.ts (for the two
 * paths that live in this package) and apps/api/test/create-owner.test.ts; the table's own
 * no-two-alike property is asserted in packages/auth/test/provisioning.test.ts.
 */
export const PROVISIONING = {
  /** `ensureLocalOwner` — the local topology's first-run loopback handshake. Creates the owner
   *  row with NO credential account at all (no `linkAccount` follow-up), so nothing about this
   *  path is an email/password identity. */
  localOwner: { method: 'setu-local-owner' },

  /** The guarded first-run setup route (`POST /api/auth/setup`). A human submitted an email, a
   *  name and a password, and the route links a `credential` account with it — this one genuinely
   *  IS better-auth's email-password method, so it says so. */
  serverSetup: { method: 'email-password' },

  /** The admin plugin's own `POST /admin/create-user` (Setu's admin-invite flow). better-auth
   *  passes `{ method: 'admin' }` there itself — verified in the installed 1.7.3,
   *  `dist/plugins/admin/routes.mjs`. It is named here so the test fixtures that stand in for an
   *  invited user declare the SAME thing the real route declares, instead of a literal that could
   *  drift away from it unnoticed. Production code never passes this one: the plugin does. */
  adminInvite: { method: 'admin' },

  /** `pnpm auth:create-owner` (#1053) — a host-side CLI run by whoever controls the machine and
   *  the database file. The password comes from an operator bootstrapping the instance, not from
   *  anyone authenticating. */
  cli: { method: 'setu-cli' },

  /** `@setu/demo-data`'s seeder — fabricated demo accounts, dev-only. */
  demoData: { method: 'setu-demo-data' },

  /** `e2e/lib/seed-users.ts` — the Playwright harness's fixture users. */
  e2eSeed: { method: 'setu-e2e-seed' }
} as const satisfies Record<string, UserProvisioningSource>
