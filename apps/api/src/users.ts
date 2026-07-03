import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { account } from '@setu/db-sqlite/schema'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Actor } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

export interface UsersApiOptions {
  /** The SAME drizzle handle better-auth's own createAuth uses for its tables (server.ts's
   *  `authDb`, shared with the `account`/`user` tables — see packages/db-sqlite/src/schema.ts) —
   *  not a separate connection, so this always reflects the live credential state. */
  db: BetterSQLite3Database
  resolveActor: ResolveActor
}

/** Owner-gated read of "which users have a credential (password) account" — the third row status
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
 *  (authMiddleware); session without `users.manage` -> 403; any query failure -> a generic 500
 *  with no leaked detail (mirrors createUploadApi's/createGitApi's own `app.onError`). */
export function createUsersApi(opts: UsersApiOptions) {
  const { db } = opts
  const app = new Hono<{ Variables: { actor: Actor } }>()

  app.get('/api/users/credential-status', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'users.manage')) return c.json({ error: 'forbidden' }, 403)

    const rows = await db
      .select({ userId: account.userId })
      .from(account)
      .where(eq(account.providerId, 'credential'))

    const status: Record<string, true> = {}
    for (const row of rows) status[row.userId] = true
    return c.json(status)
  })

  app.onError((err, c) => {
    console.error('[users] credential-status query failed:', err instanceof Error ? err.message : String(err))
    return c.json({ error: 'internal error' }, 500)
  })
  return app
}
