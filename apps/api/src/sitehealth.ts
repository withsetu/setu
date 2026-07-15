import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { lookup } from 'node:dns/promises'
import {
  createAuthz,
  DEFAULT_ROLES,
  evaluateProbe,
  safeFetch,
  SafeFetchError
} from '@setu/core'
import type { Action, Actor, ProbeResponse } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** Node DNS resolver for safeFetch's `resolveHost` seam (#288): resolve every A/AAAA
 *  answer so a hostname pointing at an internal address is caught before the socket
 *  opens. Node-only — the Workers build omits this and keeps the other guards. */
const nodeResolveHost = async (hostname: string): Promise<string[]> => {
  const answers = await lookup(hostname, { all: true })
  return answers.map((a) => a.address)
}

/** Site Health live-probe endpoint (#373). Fetches the deployed site through the
 *  SSRF-guarded `safeFetch` (own configured URL only) and evaluates the runtime rubric
 *  items (HTTPS, HSTS today; CSP/nosniff/CWV plug into `evaluateProbe` next). Read-only,
 *  throttled, and honest: when there's no reachable URL it degrades to
 *  `{ available: false, reason }` — never a false pass/fail (saved ≠ live).
 *
 *  Authz (#362, OWASP A01): gated `sitehealth.view` (Maintainer+/Admin) via the shared
 *  `authMiddleware` + `authz.can` pattern — the server is the enforcement boundary.
 *  Cost-safe: admin-triggered, throttled server-side, no per-visitor fan-out. */
export function createSiteHealthApi(opts: {
  resolveActor: ResolveActor
  /** Live getter for the configured site URL (settings.general.url). */
  siteUrl: () => string
  /** Injectable for tests; defaults to the real SSRF-guarded helper. */
  safeFetchImpl?: typeof safeFetch
  resolveHost?: (hostname: string) => Promise<string[]>
  /** Injectable clock for the throttle (tests). */
  now?: () => number
  throttleMs?: number
}) {
  const {
    resolveActor,
    siteUrl,
    safeFetchImpl = safeFetch,
    resolveHost = nodeResolveHost,
    now = () => Date.now(),
    throttleMs = 30_000
  } = opts

  // Server-side throttle: one probe per window, cached in memory. Cost-safe and keeps a
  // rapid re-click from hammering the deployed origin.
  let last: {
    at: number
    report: Extract<ProbeResponse, { available: true }>
  } | null = null

  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(resolveActor)
  const canView = requireCan('sitehealth.view')

  app.post('/api/sitehealth/probe', auth, canView, async (c) => {
    const url = siteUrl().trim()
    if (url === '')
      return c.json<ProbeResponse>({
        available: false,
        reason: 'no-url',
        detail: 'Set your site URL under Settings to run live checks.'
      })

    if (last && now() - last.at < throttleMs)
      return c.json<ProbeResponse>(last.report)

    let res
    try {
      res = await safeFetchImpl(url, undefined, { resolveHost })
    } catch (e) {
      if (e instanceof SafeFetchError)
        return c.json<ProbeResponse>({
          available: false,
          reason: e.reason,
          detail: e.message
        })
      return c.json<ProbeResponse>({
        available: false,
        reason: 'fetch-failed',
        detail: e instanceof Error ? e.message : 'Could not reach the site.'
      })
    }

    const report = {
      available: true as const,
      probedAt: new Date(now()).toISOString(),
      results: evaluateProbe({
        finalUrl: res.finalUrl,
        status: res.status,
        headers: res.headers
      })
    }
    last = { at: now(), report }
    return c.json<ProbeResponse>(report)
  })

  app.onError(apiOnError({ scope: 'sitehealth' })) // #291: prod-generic, never err.message
  return app
}
