import { Hono } from 'hono'
import { createAuthz, DEFAULT_ROLES, resolveOembed } from '@setu/core'
import type { Actor, OembedResult } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import type { ResolveActor } from './auth/resolve-actor'

const MAX_URL = 2048

export interface OembedApiOptions {
  resolveActor: ResolveActor
  /** Injected fetch — edge-safe + testable; later routed through the shared safe-fetch helper (#288). */
  fetchImpl?: typeof fetch
}

/** `POST /api/oembed { url }` → resolved oEmbed metadata for the embed block (#187).
 *
 *  Gated on `content.create` (an authoring capability), NOT admin: unlike the raw-HTML block
 *  (#260), this only ever embeds allow-listed providers rendered in a sandboxed iframe, so it is
 *  safe for authors. The resolver (`@setu/core`) is the SSRF boundary — an un-allow-listed URL
 *  never triggers a fetch. Envelope validation is inline (a single URL field); the real URL vetting
 *  lives in the tested `matchProvider`, so adding Zod here would add a dependency for no extra
 *  safety. Fails closed: forbidden/invalid → 4xx, upstream problems → 502. */
export function createOembedApi(opts: OembedApiOptions) {
  const authz = createAuthz(DEFAULT_ROLES)
  // No factory-local cors(): CORS + CSRF origin policy is owned centrally by server.ts
  // (allowlisted cors() + originGuard, #248) — a local cors() here would be a security hole.
  const app = new Hono<{ Variables: { actor: Actor } }>()

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

    const result: OembedResult = await resolveOembed(url, {
      fetchImpl: opts.fetchImpl
    })
    if (result.ok) return c.json({ data: result.data })
    // `unsupported` is client-actionable (paste a different link) → 422; upstream problems → 502.
    if (result.reason === 'unsupported')
      return c.json({ error: 'unsupported_provider' }, 422)
    return c.json({ error: result.reason }, 502)
  })

  app.onError(apiOnError({ scope: 'oembed' })) // #291: e.g. an unexpected resolver throw
  return app
}
