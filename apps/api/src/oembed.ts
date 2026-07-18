import { Hono } from 'hono'
import {
  createAuthz,
  DEFAULT_ROLES,
  resolveOembed,
  OEMBED_ENDPOINT_HOSTS,
  OEMBED_MAX_BODY_BYTES
} from '@setu/core'
import type { Actor, OembedResult } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import { createSafeFetchImpl } from './net'
import type { ResolveActor } from './auth/resolve-actor'

const MAX_URL = 2048

export interface OembedApiOptions {
  resolveActor: ResolveActor
  /** Raw transport the SSRF guard drives. Defaults to the platform fetch; tests inject a stub.
   *  There is deliberately NO way to bypass the guard — see the factory comment. */
  transport?: typeof fetch
  /** DNS seam for the guard. Defaults to Node's resolver; tests inject a stub to stay offline. */
  resolveHost?: (hostname: string) => Promise<string[]>
}

/** `POST /api/oembed { url }` → resolved oEmbed metadata for the embed block (#187).
 *
 *  Gated on `content.create` (an authoring capability), NOT admin: unlike the raw-HTML block
 *  (#260), this only ever embeds allow-listed providers rendered in a sandboxed iframe, so it is
 *  safe for authors.
 *
 *  SSRF (#626, OWASP A01): the resolver's provider allowlist pins the FIRST hop only, so the fetch
 *  itself MUST go through the shared safeFetch seam — this factory builds that `fetchImpl` itself
 *  rather than taking one from the mount site, so a mount can never forget it (the #626 bug was
 *  exactly that: server.ts mounted with no fetchImpl, core fell back to `globalThis.fetch` with
 *  `redirect: 'follow'`, and a provider 302 to 169.254.169.254 was followed unvalidated). The guard
 *  re-validates every hop against the provider-endpoint host allowlist and caps the response body
 *  while streaming rather than after `res.text()` has buffered it. A blocked or oversized fetch
 *  throws SafeFetchError, which resolveOembed's own catch turns into `fetch_failed` → 502 — never
 *  an escaped 500, and never a leaked internal address in the response.
 *
 *  Envelope validation is inline (a single URL field); the real URL vetting
 *  lives in the tested `matchProvider`, so adding Zod here would add a dependency for no extra
 *  safety. Fails closed: forbidden/invalid → 4xx, upstream problems → 502. */
export function createOembedApi(opts: OembedApiOptions) {
  const authz = createAuthz(DEFAULT_ROLES)
  // No factory-local cors(): CORS + CSRF origin policy is owned centrally by server.ts
  // (allowlisted cors() + originGuard, #248) — a local cors() here would be a security hole.
  const app = new Hono<{ Variables: { actor: Actor } }>()

  const fetchImpl = createSafeFetchImpl({
    ...(opts.transport ? { transport: opts.transport } : {}),
    allowHosts: OEMBED_ENDPOINT_HOSTS,
    maxBytes: OEMBED_MAX_BODY_BYTES,
    ...(opts.resolveHost ? { resolveHost: opts.resolveHost } : {})
  })

  app.post('/api/oembed', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'content.create'))
      return c.json({ error: 'forbidden' }, 403)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    const url = (body as { url?: unknown } | null)?.url
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL)
      return c.json({ error: 'invalid_url' }, 400)

    const result: OembedResult = await resolveOembed(url, { fetchImpl })
    if (result.ok) return c.json({ data: result.data })
    // `unsupported` is client-actionable (paste a different link) → 422; upstream problems → 502.
    if (result.reason === 'unsupported')
      return c.json({ error: 'unsupported_provider' }, 422)
    return c.json({ error: result.reason }, 502)
  })

  app.onError(apiOnError({ scope: 'oembed' })) // #291: e.g. an unexpected resolver throw
  return app
}
