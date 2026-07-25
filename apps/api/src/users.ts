import { Hono } from 'hono'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { account, user } from '@setu/db-sqlite/schema'
import {
  createAuthz,
  DEFAULT_ROLES,
  canonicalRoleOf,
  outranks
} from '@setu/core'
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
  /** #500 review: sends a password-reset email to the given address, via better-auth's
   *  SERVER-SIDE call (server.ts passes `auth.api.requestPasswordReset`). Server-side because the
   *  captcha plugin protects the public HTTP `/request-password-reset` by default (1.6.24
   *  dist/plugins/captcha/constants.mjs) via an `onRequest` hook — HTTP-only, so this internal
   *  call is exempt while the unauthenticated endpoint stays protected; an already-authenticated,
   *  authz-gated admin action should not solve bot challenges. Omitted when reset isn't wired
   *  (no from-address / no admin origin — the same `email:` ternary server.ts feeds createAuth),
   *  and the route answers 409 honestly. */
  requestPasswordReset?: (email: string) => Promise<void>
}

const sendResetBody = z.object({ userId: z.string().min(1).max(256) })

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

  /** #500/#453: the admin-surface reset-email trigger (Users row action + the passwordless
   *  non-admin's own-password card). Authz mirrors the row-action UI exactly
   *  (UsersScreen.tsx's `resetOffered`): SELF is always allowed — emailing yourself a reset link
   *  is the public forgot-password flow with a known-good address, no permission needed beyond a
   *  session; any OTHER target needs `users.view` AND strict rank (known role + outranks — an
   *  admin cannot trigger one for a peer admin, and an unknown/legacy target role fails closed
   *  for everyone). Fail-closed ladder: 401 unauth → 400 bad body → 403 unauthorized → 409 reset
   *  not wired → 404 unknown target. Covered (incl. wrong-actor + kill-shot) by
   *  apps/api/test/users-send-reset.test.ts. */
  app.post(
    '/api/users/send-reset',
    authMiddleware(opts.resolveActor),
    async (c) => {
      const actor = c.get('actor')
      const parsed = sendResetBody.safeParse(
        await c.req.json().catch(() => null)
      )
      if (!parsed.success) return c.json({ error: 'invalid body' }, 400)
      const { userId } = parsed.data

      const isSelf = userId === actor.id
      // Authz BEFORE the target lookup: an actor who may not ask about other users learns
      // nothing about which ids exist.
      if (!isSelf && !authz.can(actor, 'users.view'))
        return c.json({ error: 'forbidden' }, 403)

      if (!opts.requestPasswordReset)
        return c.json({ error: 'password reset is not available' }, 409)

      const [target] = await db
        .select({ id: user.id, email: user.email, role: user.role })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
      // Reachable only by users.view holders (or a self id that vanished mid-session) — the
      // roster route already shows them every id, so a 404 leaks nothing new.
      if (!target) return c.json({ error: 'not found' }, 404)

      if (!isSelf) {
        // canonicalRoleOf is the multi-role-safe reading (#630); null (unknown/legacy role)
        // fails closed for EVERY actor — the repair path for such rows is setRole, not email.
        const targetRole = canonicalRoleOf(target.role)
        if (targetRole === null || !outranks(actor.role, targetRole))
          return c.json({ error: 'forbidden' }, 403)
      }

      await opts.requestPasswordReset(target.email)
      return c.json({ status: true })
    }
  )

  // #291: the shared handler keeps this factory's server-side log line (scope → `[api:users]`)
  // and its no-leak envelope, now with a correlation id.
  app.onError(apiOnError({ scope: 'users' }))
  return app
}
