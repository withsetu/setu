import type { Context, ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

/** Fail-secure error handling (#291, OWASP A10:2025 — Mishandling of Exceptional Conditions).
 *
 *  Every Hono factory in this app mounts `apiOnError` (see docs/security-standards.md, "Error
 *  handling"). An unhandled throw must never leak internal detail — messages carry filesystem
 *  paths, SQL, library internals — so the client gets a generic envelope and a short correlation
 *  id, while the FULL error is logged server-side under the same id (a reported response can be
 *  matched to its log line).
 *
 *  Deliberately pure Hono + Web APIs (no `node:` imports): `crypto.randomUUID()` is the Web
 *  Crypto global, available on Node ≥19 and Cloudflare Workers alike, so the identical handler
 *  works on every topology. */

/** Short (8-char base36) correlation id — derived from the first 48 bits of a Web Crypto UUID.
 *  Not a secret, not guessable-sensitive: it only pairs a client-visible response with a server
 *  log line. */
export function correlationId(): string {
  const bits48 = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  return parseInt(bits48, 16).toString(36).padStart(8, '0').slice(0, 8)
}

/** Mirrors server.ts's existing prod check. Guarded so the module stays loadable on runtimes
 *  without a `process` global (Workers without nodejs_compat). */
function isProd(): boolean {
  return (
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
  )
}

export interface ApiOnErrorOptions {
  /** Factory tag folded into the server-side log line, e.g. 'users' → `[api:users]` — this is
   *  where any factory-specific logging lives now (users.ts used to roll its own). */
  scope?: string
}

/** The mandatory `app.onError` for every Hono factory (and the root app in server.ts).
 *
 *  - Hono `HTTPException`s pass through untouched (`err.getResponse()`): those are deliberate,
 *    safe responses (guards, body limits), not faults.
 *  - Everything else → 500 `{ error: 'internal_error', id }`. Outside production the envelope
 *    additionally carries `detail: err.message` as a dev convenience — never the stack, and
 *    never anything in production. */
export function apiOnError(opts: ApiOnErrorOptions = {}): ErrorHandler {
  const tag = opts.scope ? `[api:${opts.scope}]` : '[api]'
  return (err: Error, c: Context): Response => {
    if (err instanceof HTTPException) return err.getResponse()
    const id = correlationId()
    // Full error (message + stack) stays server-side only, keyed by the correlation id.
    console.error(
      `${tag} unhandled error id=${id} ${c.req.method} ${c.req.path}`,
      err
    )
    const detail = err instanceof Error ? err.message : String(err)
    return c.json(
      isProd()
        ? { error: 'internal_error', id }
        : { error: 'internal_error', id, detail },
      500
    )
  }
}
