import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'
import { constantTimeTokenEquals } from './local-token-plugin'
import type { AuthEvent } from './events'

const setupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1),
  token: z.string(),
})

export interface ServerSetupOptions {
  /** Returns the current boot-minted setup token, or null when this topology has no setup route
   *  at all (local mode — the loopback handshake covers first-run there instead). */
  getSetupToken: () => string | null
  /** Live row count of the `user` table, checked fresh on every request (not a boot-time
   *  snapshot) — setup must close the instant the first owner exists, from ANY path (this route,
   *  or e.g. a directly-created user). */
  countUsers: () => number
  /** #248 Task 9: audit-event emission. Direct emission point, distinct from the generic
   *  user.created event (databaseHooks.user.create.after fires for ANY user insert, including this
   *  one) — setup.completed specifically marks "first-run setup finished", a fact the generic hook
   *  can't express. createAuth wires this to the same onAuthEvent callback threaded through
   *  CreateAuthOptions; defaults to a no-op when omitted. */
  onAuthEvent?: (event: AuthEvent) => void
}

/** Better Auth server plugin exposing `POST /setup` (mounted at `/api/auth/setup` under our
 *  basePath) — the one-time hosted/self-hosted first-run owner creation flow. Companion to
 *  local-token-plugin.ts's loopback handshake, for topologies where there is no local process to
 *  trust implicitly: the operator is handed a token printed to the server log at boot, and must
 *  present it (alongside a chosen email/password/name) to create the single owner account.
 *
 *  Guards, in order, all fail-closed:
 *   1. `getSetupToken()` non-null, else 404 — the endpoint "doesn't exist" in local topology.
 *   2. `countUsers() === 0` AND the in-process latch is unclaimed, else 403 `{ error: 'setup
 *      already completed' }` — setup is one-time, checked against the LIVE row count (not a
 *      boot-time snapshot) so it closes the instant any owner exists, from any path.
 *   3. Request body validated (Zod) — malformed input never reaches the DB.
 *   4. Request body `token` matches via constant-time comparison (reusing local-token-plugin's
 *      `constantTimeTokenEquals` rather than a second copy), else 401 — and does NOT claim the
 *      latch, so a mistyped token never blocks a subsequent correct attempt.
 *
 *  Race safety: two concurrent POSTs must not both create an owner. The zero-users check above is
 *  a live DB read, which is NOT atomic with the create that follows it — two requests could both
 *  observe `countUsers() === 0` before either has inserted. So there is a second, synchronous
 *  in-process latch (`claimed`, mirroring local-token-plugin's `consumed` flag): it is set
 *  immediately after the token check passes and BEFORE any `await` — the same
 *  no-await-in-the-check-window invariant local-token-plugin.ts documents — so the second of two
 *  concurrent requests sees `claimed === true` and 403s before it ever calls createUser. This is
 *  an in-process guarantee only (correct for Setu's single-process Node/edge-isolate topologies;
 *  it would need a DB-level unique constraint or transaction to hold across multiple processes
 *  sharing one DB, which is out of scope here). */
export function serverSetup(opts: ServerSetupOptions): BetterAuthPlugin {
  // In-process latch — see the race-safety note above. Independent of `getSetupToken()` (a
  // stable topology-level fact) for the same reason local-token-plugin keeps `consumed` separate
  // from `getToken()`: conflating "no setup route in this topology" (404) with "setup already
  // claimed" (403) would make the two indistinguishable.
  let claimed = false

  return {
    id: 'server-setup',
    endpoints: {
      serverSetup: createAuthEndpoint(
        '/setup',
        { method: 'POST', body: setupBodySchema },
        async (ctx) => {
          const setupToken = opts.getSetupToken()
          if (setupToken === null) throw ctx.error('NOT_FOUND')

          if (claimed || opts.countUsers() > 0) {
            throw ctx.error('FORBIDDEN', { message: 'setup already completed' })
          }

          if (!constantTimeTokenEquals(ctx.body.token, setupToken)) {
            throw ctx.error('UNAUTHORIZED', { message: 'invalid setup token' })
          }

          // INVARIANT: no `await` between this check/claim pair and the read above — see the
          // class comment. From here on, any concurrent request sees `claimed === true`.
          claimed = true

          const user = await ctx.context.internalAdapter.createUser({
            email: ctx.body.email,
            name: ctx.body.name,
            emailVerified: false,
            role: 'admin',
          })
          const hashedPassword = await ctx.context.password.hash(ctx.body.password)
          await ctx.context.internalAdapter.linkAccount({
            userId: user.id,
            accountId: user.id,
            providerId: 'credential',
            password: hashedPassword,
          })

          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          opts.onAuthEvent?.({ type: 'setup.completed', targetId: user.id })
          return ctx.json({ status: true, user: { id: user.id, email: user.email } })
        },
      ),
    },
  }
}
