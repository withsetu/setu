import { createMiddleware } from 'hono/factory'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** true when `origin` matches `pattern` exactly, or `pattern` is a
 *  wildcard-subdomain pattern (`https://*.host`) and `origin` is any
 *  `https://<sub>.host` (or the bare `https://host` itself is NOT matched by
 *  the wildcard — only a subdomain is). Exported so server.ts's CORS `origin`
 *  function can share the same matching rules as the guard. */
export function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true
  const starIdx = pattern.indexOf('*.')
  if (starIdx === -1) return false
  const prefix = pattern.slice(0, starIdx) // e.g. "https://"
  const suffix = pattern.slice(starIdx + 1) // e.g. ".trycloudflare.com"
  return origin.startsWith(prefix) && origin.endsWith(suffix) && origin.length > prefix.length + suffix.length
}

/** Extract the host (authority, no scheme/path) from an origin string like
 *  `https://sub.example.com:8443`. Returns null if unparseable. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

const LOOPBACK_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOST_RE.test(host)
}

/** Origin/Host guard — the DNS-rebinding/tunnel-detection check.
 *
 *  Safe methods (GET/HEAD/OPTIONS) always pass.
 *
 *  Unsafe methods:
 *   - If an Origin header is present, it must match the allowlist (exact
 *     origin, or a wildcard-subdomain pattern like `https://*.host`).
 *   - If no Origin header is present (curl, server-to-server), pass only if
 *     Host is a loopback host (localhost/127.0.0.1/[::1], optional port) or
 *     matches the host of an allowlisted origin. Otherwise fail closed.
 */
export function originGuard(allowed: () => string[]) {
  return createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next()
      return
    }

    const origin = c.req.header('origin')
    const allowedList = allowed()

    if (origin) {
      if (allowedList.some((pattern) => originMatches(origin, pattern))) {
        await next()
        return
      }
      return c.json({ error: 'origin not allowed' }, 403)
    }

    const host = c.req.header('host')
    if (host) {
      if (isLoopbackHost(host)) {
        await next()
        return
      }
      const allowedHosts = allowedList.map(hostOf).filter((h): h is string => h !== null)
      if (allowedHosts.includes(host)) {
        await next()
        return
      }
    }

    return c.json({ error: 'origin not allowed' }, 403)
  })
}
