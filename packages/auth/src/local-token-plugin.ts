import { timingSafeEqual, createHash } from 'node:crypto'
import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'
import type { AuthEvent } from './events'

/** true when `host` (a `Host` header value, e.g. `localhost:4444` or `127.0.0.1`) is a loopback
 *  host — localhost/127.0.0.1/[::1], any port. Mirrors the loopback rule in
 *  apps/api/src/auth/origin-guard.ts (kept as a small standalone export here since this plugin
 *  lives in @setu/auth and must not depend on @setu/api). */
export function isLoopbackHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
}

/** Constant-time token comparison. Both sides are hashed with sha256 FIRST so the buffers being
 *  compared are always equal-length (32 bytes) — `crypto.timingSafeEqual` throws if given
 *  unequal-length buffers, which would itself leak timing/error information tied to length. */
export function constantTimeTokenEquals(a: string, b: string): boolean {
  const hashedA = createHash('sha256').update(a).digest()
  const hashedB = createHash('sha256').update(b).digest()
  return timingSafeEqual(hashedA, hashedB)
}

const exchangeBodySchema = z.object({ token: z.string() })

export interface LocalTokenOptions {
  /** Returns the CURRENT local exchange token, or null when the server topology has none (e.g.
   *  not running in local mode). #386: the provider re-mints on `consume()`, so this is mutable
   *  state — a valid unused token always exists for the process lifetime. */
  getToken: () => string | null
  /** Marks the current token as consumed. The provider contract (#386) is to SYNCHRONOUSLY
   *  re-mint here (rotation), so the consumed token stops matching `getToken()` and a fresh one
   *  immediately exists. Called BEFORE session creation is attempted, so the token is single-use
   *  even if session creation subsequently fails. Callers that don't rotate (e.g. no-op consume
   *  in tests) are still covered by the plugin's own last-consumed-token fallback below. */
  consume: () => void
  /** Resolves the user id to create a session for. May reject (e.g. before Task 7 wires up
   *  ensureLocalOwner) — that failure surfaces as a 500-class error, distinct from the guard
   *  failures below, which are all fail-closed 401/403/404. */
  localUserId: () => Promise<string>
  /** #248 Task 9: audit-event emission. Direct emission point (not a databaseHooks hook) because
   *  the exchange itself doesn't create/update a user row — createAuth wires this to the same
   *  onAuthEvent callback threaded through CreateAuthOptions; defaults to a no-op when omitted. */
  onAuthEvent?: (event: AuthEvent) => void
}

/** Better Auth server plugin exposing `POST /local/exchange` (mounted at
 *  `/api/auth/local/exchange` under our basePath) — the loopback token handshake. A local desktop
 *  boot mints a token; the admin exchanges it here for a completely normal Better Auth session
 *  (a real session row + cookie via `internalAdapter.createSession` + `setSessionCookie`). No
 *  parallel auth system.
 *
 *  Guards, in order, all fail-closed:
 *   1. `getToken()` non-null, else 404 — the endpoint "doesn't exist" outside local topology.
 *   2. Request body `token` matches the CURRENT `getToken()` via constant-time comparison, else
 *      401 — and a replay of the last-consumed token is 401 too (see below).
 *   3. `Host` header is a loopback host, else 403.
 *   4. `consume()` — single-use, called before session creation so a subsequent session-creation
 *      failure still burns the token.
 *
 *  ## Single-use via rotation (#386, provider contract)
 *
 *  Single-use is guaranteed by ROTATION, not a local consumed flag: the provider's `consume()`
 *  synchronously re-mints its token, so the consumed value stops matching `getToken()` and any
 *  replay fails the constant-time comparison (401) while a fresh, unused token always exists —
 *  the owner can recover admin access without restarting the API. The pre-#386 `consumed`
 *  closure flag made the endpoint permanently dead after one exchange, which is exactly the
 *  lockout this replaces.
 *
 *  Defensive fallback: some callers wire a NON-rotating `consume` (e.g. `() => {}` in tests or
 *  minimal integrations). For those, `getToken()` would keep returning the consumed value, so the
 *  plugin ALSO remembers the last token it consumed and rejects it with 401 — single-use never
 *  regresses regardless of the provider's rotation behavior. With a rotating provider this
 *  fallback is redundant (the replay already mismatches), never harmful: the remembered value is
 *  by definition no longer the current token. */
export function localToken(opts: LocalTokenOptions): BetterAuthPlugin {
  // Last-consumed-token fallback (see the doc above) — independent of `getToken()`, which
  // represents a stable topology-level fact ("does local-token capability exist at all").
  // Conflating the two would make "already consumed" (401) indistinguishable from "this topology
  // has no local token" (404).
  let lastConsumedToken: string | null = null

  return {
    id: 'local-token',
    endpoints: {
      localExchange: createAuthEndpoint(
        '/local/exchange',
        { method: 'POST', body: exchangeBodySchema },
        async (ctx) => {
          // INVARIANT: no `await` may occur between reading `getToken()` below and the
          // `lastConsumedToken = token` + `opts.consume()` (synchronous rotation) writes —
          // that synchronous window is what makes single-use race-free under Node's event
          // loop. An await inserted between them would let two concurrent exchanges both
          // pass the checks against the same token.
          const token = opts.getToken()
          if (token === null) throw ctx.error('NOT_FOUND')

          // Defensive fallback for non-rotating providers: a replay of the exact token we
          // already consumed is always rejected, even when getToken() still returns it.
          if (
            lastConsumedToken !== null &&
            constantTimeTokenEquals(ctx.body.token, lastConsumedToken)
          ) {
            throw ctx.error('UNAUTHORIZED', {
              message: 'token already consumed'
            })
          }

          if (!constantTimeTokenEquals(ctx.body.token, token)) {
            throw ctx.error('UNAUTHORIZED', { message: 'invalid token' })
          }

          const host = ctx.headers?.get('host') ?? ''
          if (!isLoopbackHost(host)) {
            throw ctx.error('FORBIDDEN', {
              message: 'exchange must be requested from a loopback host'
            })
          }

          // Single-use from here on, regardless of what happens next: remember the consumed
          // value (fallback) and let the provider rotate (primary mechanism) — both synchronous,
          // before the first await below.
          lastConsumedToken = token
          opts.consume()

          const userId = await opts.localUserId()
          const session =
            await ctx.context.internalAdapter.createSession(userId)
          const user = await ctx.context.internalAdapter.findUserById(userId)
          if (!user)
            throw ctx.error('INTERNAL_SERVER_ERROR', {
              message: 'local user not found'
            })

          await setSessionCookie(ctx, { session, user })
          opts.onAuthEvent?.({ type: 'local.exchange', targetId: userId })
          return ctx.json({ status: true })
        }
      )
    }
  }
}
