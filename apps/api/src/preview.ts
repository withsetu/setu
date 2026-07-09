import { Hono } from 'hono'

/** A draft pushed by the editor for in-editor preview (the compiled `.mdoc` + its ref). */
export interface PreviewDraft {
  content: string
  collection: string
  locale: string
  slug: string
}

/** A Hono app holding the single "current preview draft" slot. The editor POSTs the draft it
 *  wants to preview; the site's dev-only preview route GETs it and renders it through the theme.
 *  Single slot = the one entry being previewed (single-user dev); key-by-ref later.
 *  CORS/origin policy is owned centrally by server.ts (see app.ts's comment on createGitApi) —
 *  this factory no longer sets its own permissive `cors()`. */
export function createPreviewApi(): Hono {
  let slot: PreviewDraft | null = null
  const app = new Hono()

  app.post('/preview', async (c) => {
    slot = await c.req.json()
    return c.json({ ok: true })
  })

  app.get('/preview', (c) =>
    slot ? c.json(slot) : c.json({ error: 'no preview draft' }, 404)
  )

  return app
}
