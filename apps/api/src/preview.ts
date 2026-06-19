import { Hono } from 'hono'
import { cors } from 'hono/cors'

/** A draft pushed by the editor for in-editor preview (the compiled `.mdoc` + its ref). */
export interface PreviewDraft {
  content: string
  collection: string
  locale: string
  slug: string
}

/** A Hono app holding the single "current preview draft" slot. The editor POSTs the draft it
 *  wants to preview; the site's dev-only preview route GETs it and renders it through the theme.
 *  Single slot = the one entry being previewed (single-user dev); key-by-ref later. */
export function createPreviewApi(): Hono {
  let slot: PreviewDraft | null = null
  const app = new Hono()
  app.use('*', cors())

  app.post('/preview', async (c) => {
    slot = (await c.req.json()) as PreviewDraft
    return c.json({ ok: true })
  })

  app.get('/preview', (c) => (slot ? c.json(slot) : c.json({ error: 'no preview draft' }, 404)))

  return app
}
