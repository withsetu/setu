import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { apiOnError } from './errors'

/** A draft pushed by the editor for in-editor preview (the compiled `.mdoc` + its ref). */
export interface PreviewDraft {
  content: string
  collection: string
  locale: string
  slug: string
}

/** Max bytes for a posted preview draft — one compiled `.mdoc` is small; this is a DoS ceiling. */
const PREVIEW_MAX_BYTES = 1 * 1024 * 1024

export interface PreviewApiOptions {
  /** Register the routes only when true. In-editor preview is a DEV-ONLY feature: the site route
   *  that renders this slot is injected solely under `astro dev`, and its GET is fetched
   *  server-side by the site with NO session cookie, so the slot can't be auth-gated. To avoid
   *  exposing an unauthenticated read/write slot on a production server, server.ts passes
   *  `enabled: resolvePreviewEnabled(process.env)` — LOCAL MODE **and** non-production, both
   *  required (see apps/api/src/config.ts). It used to be `NODE_ENV !== 'production'` alone, which
   *  left the slot mounted on a default self-hosted boot because nothing sets NODE_ENV for the API
   *  process (#627 hardened the #419 gate). When false the routes are absent and `/preview` 404s.
   *  Defaults to true, so a caller that omits it (tests) gets the routes. */
  enabled?: boolean
}

/** A Hono app holding the single "current preview draft" slot. The editor POSTs the draft it
 *  wants to preview; the site's dev-only preview route GETs it and renders it through the theme.
 *  Single slot = the one entry being previewed (single-user dev); key-by-ref later.
 *  CORS/origin policy is owned centrally by server.ts (see app.ts's comment on createGitApi) —
 *  this factory no longer sets its own permissive `cors()`. */
export function createPreviewApi(opts: PreviewApiOptions = {}): Hono {
  const app = new Hono()
  app.onError(apiOnError({ scope: 'preview' })) // #291: prod-generic, never err.message
  if (opts.enabled === false) return app // production: no routes → /preview 404s.

  let slot: PreviewDraft | null = null

  app.post(
    '/preview',
    bodyLimit({
      maxSize: PREVIEW_MAX_BYTES,
      onError: (c) => c.json({ error: 'payload too large' }, 413)
    }),
    async (c) => {
      slot = await c.req.json()
      return c.json({ ok: true })
    }
  )

  app.get('/preview', (c) =>
    slot ? c.json(slot) : c.json({ error: 'no preview draft' }, 404)
  )

  return app
}
