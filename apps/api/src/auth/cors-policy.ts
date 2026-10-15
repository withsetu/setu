import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { originMatches, pathIsPublic } from './origin-guard'

/** Routes that are deliberately public and read NO ambient credentials (no session cookie, no auth
 *  check) — captcha is the only gate. `originGuard` skips its origin check for them and `apiCors`
 *  serves them the non-credentialed policy below. Anything that reads a session (e.g. the
 *  `/forms/submissions` admin CRUD routes) must NOT be listed here.
 *  Pinned by apps/api/test/cors-policy.test.ts. */
export const PUBLIC_PATHS = ['/forms/submit']

/** The public contact form posts JSON from the SITE's origin, which in a split-origin deployment is
 *  not the API's and is not on the credentialed allowlist (#1264). It gets `*` without credentials:
 *  the browser then sends no cookies and lets any page read the response — the route reads no
 *  session, and the response carries only the submission's own outcome. */
const publicCors = cors({
  origin: '*',
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: false
})

/** The API's CORS policy: `PUBLIC_PATHS` get `publicCors`; every other route gets the credentialed
 *  allowlist (the same list `originGuard` and better-auth's `trustedOrigins` use). One middleware,
 *  so the two policies can never both write headers on one response — Hono's `cors()` is
 *  last-write-wins. Pinned by apps/api/test/cors-policy.test.ts. */
export function apiCors(allowed: () => readonly string[]) {
  const credentialedCors = cors({
    origin: (origin) => {
      if (!origin) return undefined
      return allowed().some((pattern) => originMatches(origin, pattern))
        ? origin
        : undefined
    },
    credentials: true
  })
  return createMiddleware(async (c, next) =>
    pathIsPublic(c.req.path, PUBLIC_PATHS)
      ? publicCors(c, next)
      : credentialedCors(c, next)
  )
}
