import { timingSafeEqual, createHash } from 'node:crypto'
import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'

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
  /** Returns the current boot-minted local exchange token, or null when the server topology has
   *  none (e.g. not running in local mode, or it has already been consumed). */
  getToken: () => string | null
  /** Marks the token as consumed. Called BEFORE session creation is attempted, so the token is
   *  single-use even if session creation subsequently fails. */
  consume: () => void
  /** Resolves the user id to create a session for. May reject (e.g. before Task 7 wires up
   *  ensureLocalOwner) — that failure surfaces as a 500-class error, distinct from the guard
   *  failures below, which are all fail-closed 401/403/404. */
  localUserId: () => Promise<string>
}

/** Better Auth server plugin exposing `POST /local/exchange` (mounted at
 *  `/api/auth/local/exchange` under our basePath) — the loopback token handshake. A local desktop
 *  boot mints a one-time token; the admin exchanges it here for a completely normal Better Auth
 *  session (a real session row + cookie via `internalAdapter.createSession` + `setSessionCookie`).
 *  No parallel auth system.
 *
 *  Guards, in order, all fail-closed:
 *   1. `getToken()` non-null, else 404 — the endpoint "doesn't exist" outside local topology.
 *   2. Request body `token` matches via constant-time comparison, else 401.
 *   3. `Host` header is a loopback host, else 403.
 *   4. `consume()` — single-use, called before session creation so a subsequent session-creation
 *      failure still burns the token. */
export function localToken(opts: LocalTokenOptions): BetterAuthPlugin {
  // Single-use state lives here, in the plugin's own closure — independent of `getToken()`, which
  // represents a stable topology-level fact ("does local-token capability exist at all", checked
  // once per boot). Conflating the two would make "already consumed" (401) indistinguishable from
  // "this topology has no local token" (404).
  let consumed = false

  return {
    id: 'local-token',
    endpoints: {
      localExchange: createAuthEndpoint(
        '/local/exchange',
        { method: 'POST', body: exchangeBodySchema },
        async (ctx) => {
          const token = opts.getToken()
          if (token === null) throw ctx.error('NOT_FOUND')

          if (consumed) throw ctx.error('UNAUTHORIZED', { message: 'token already consumed' })

          if (!constantTimeTokenEquals(ctx.body.token, token)) {
            throw ctx.error('UNAUTHORIZED', { message: 'invalid token' })
          }

          const host = ctx.headers?.get('host') ?? ''
          if (!isLoopbackHost(host)) {
            throw ctx.error('FORBIDDEN', { message: 'exchange must be requested from a loopback host' })
          }

          // Single-use from here on, regardless of what happens next.
          consumed = true
          opts.consume()

          const userId = await opts.localUserId()
          const session = await ctx.context.internalAdapter.createSession(userId)
          const user = await ctx.context.internalAdapter.findUserById(userId)
          if (!user) throw ctx.error('INTERNAL_SERVER_ERROR', { message: 'local user not found' })

          await setSessionCookie(ctx, { session, user })
          return ctx.json({ status: true })
        },
      ),
    },
  }
}
