import type { MiddlewareHandler } from 'hono'

/**
 * Baseline security headers for every API response (#289).
 *
 * The API serves JSON + media assets, so:
 * - `X-Frame-Options: DENY` — stricter than the site's SAMEORIGIN; the API is never legitimately
 *   framed (the admin preview iframe frames the SITE, not this origin).
 * - `Referrer-Policy: no-referrer` — an API client never needs to leak its referrer onward.
 * - NO Content-Security-Policy — CSP governs document contexts; the site emits its own
 *   (report-only) policy via core's `defaultSecurityHeaders`.
 *
 * Headers are applied in a `finally` so error responses carry them too: after a successful
 * `next()` they mutate the finalized `c.res`; when a handler throws, they land in the context's
 * prepared headers, which Hono's error handler picks up when it builds the 500.
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next()
    } finally {
      c.header('X-Content-Type-Options', 'nosniff')
      c.header('X-Frame-Options', 'DENY')
      c.header('Referrer-Policy', 'no-referrer')
    }
  }
}
