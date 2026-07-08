import { createMiddleware } from 'hono/factory'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Fail-closed boot degradation (#248 Task 5). When auth cannot be constructed — non-local
 *  topology with no SETU_AUTH_SECRET (see resolveAuthSecret in ../config) — the server still
 *  boots and serves, but nothing that mutates state or touches identity is safe to run: there is
 *  no session signing key, so any session/token issued would be meaningless (or, worse, signed
 *  with an accidental fallback). Rather than let each route independently decide how to fail, this
 *  single global middleware short-circuits every unsafe-method request (POST/PUT/PATCH/DELETE) —
 *  including `/api/auth/*` itself — with a 503. Safe methods (GET/HEAD/OPTIONS) pass through
 *  untouched, so public reads (media serve, capabilities, CORS preflight) keep working.
 *
 *  Mount order: this only needs to run before route handlers, not before/after any other
 *  middleware in particular — it doesn't read Origin/Host (that's originGuard's job) and it
 *  doesn't touch cookies/sessions (that's authMiddleware's job). It's placed after the central
 *  CORS middleware (so CORS headers are still applied to the 503, keeping error responses
 *  fetch()-able from the admin origin) and before originGuard (arbitrary relative to it — the two
 *  guards are independent axes, method vs. origin — but placing the cheaper, purely-local check
 *  first avoids doing Origin/Host parsing work on a request we're going to 503 anyway). */
export function authUnconfiguredGuard(isAuthUnconfigured: () => boolean) {
  return createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || !isAuthUnconfigured()) {
      await next()
      return
    }
    return c.json(
      { error: 'auth not configured', hint: 'set SETU_AUTH_SECRET' },
      503
    )
  })
}
