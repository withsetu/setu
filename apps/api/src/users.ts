import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { account, user } from '@setu/db-sqlite/schema'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Actor } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

export interface UsersApiOptions {
  /** The SAME drizzle handle better-auth's own createAuth uses for its tables (server.ts's
   *  `authDb`, shared with the `account`/`user` tables — see packages/db-sqlite/src/schema.ts) —
   *  not a separate connection, so this always reflects the live credential state. */
  db: BetterSQLite3Database
  resolveActor: ResolveActor
}

/** `users.view`-gated read of "which users have a credential (password) account" — the third row status
 *  the Users & Roles screen needs (#248 Task 8 review, Finding 2) that better-auth's admin
 *  `listUsers` doesn't expose (it returns user rows, not their linked accounts).
 *
 *  `GET /api/users/credential-status` -> `{ [userId]: true }` for every user who has an `account`
 *  row with `providerId = 'credential'`. Absence of a key means passwordless (can't sign in
 *  remotely) — the caller (UsersSettings.tsx) treats "not present" as the negative case, matching
 *  the OwnerPasswordCard's own `listAccounts()`-derived state for the CURRENT user (this endpoint
 *  is the multi-user generalization of that same question).
 *
 *  Fail-closed, same shape as media.ts's authMiddleware + authz.can gate: no session -> 401
 *  (authMiddleware); session without `users.view` -> 403; any query failure -> a generic 500
 *  with no leaked detail (the shared `apiOnError`, #291). */
export function createUsersApi(opts: UsersApiOptions) {
  const { db } = opts
  const app = new Hono<{ Variables: { actor: Actor } }>()

  /** `users.view`-gated user roster. The admin Users screen previously listed via better-auth's admin
   *  plugin (`authClient.admin.listUsers` → `/api/auth/admin/list-users`), which authorizes against
   *  the plugin's OWN role map where only `admin` holds `user:list` — so a maintainer, who DOES hold
   *  Setu's `users.view` and sees the nav/screen, got "not allowed to list users" (UAT 2026-07-05:
   *  the two authz systems disagreed). This Setu-owned route authorizes against the SAME `authz`
   *  matrix that gates the nav/route, so `users.view` "just works" for maintainer+. User MANAGEMENT
   *  (invite/setRole/disable/delete) stays on the admin plugin (admin-only) until #364 wires
   *  maintainer's rank-scoped management to the matrix. Fail-closed: no session -> 401; session
   *  without `users.view` -> 403. */
  app.get('/api/users', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'users.view'))
      return c.json({ error: 'forbidden' }, 403)

    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        role: user.role,
        banned: user.banned,
        banReason: user.banReason,
        banExpires: user.banExpires,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      })
      .from(user)
      .orderBy(asc(user.createdAt))

    return c.json({ users })
  })

  app.get(
    '/api/users/credential-status',
    authMiddleware(opts.resolveActor),
    async (c) => {
      if (!authz.can(c.get('actor'), 'users.view'))
        return c.json({ error: 'forbidden' }, 403)

      const rows = await db
        .select({ userId: account.userId })
        .from(account)
        .where(eq(account.providerId, 'credential'))

      const status: Record<string, true> = {}
      for (const row of rows) status[row.userId] = true
      return c.json(status)
    }
  )

  // #291: the shared handler keeps this factory's server-side log line (scope → `[api:users]`)
  // and its no-leak envelope, now with a correlation id.
  app.onError(apiOnError({ scope: 'users' }))
  return app
}
