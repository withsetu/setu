import { Hono } from 'hono'
import type { SubmissionService, SubmissionPort, SubmissionFilter } from '@setu/core'

/** A Hono app exposing the forms submit pipeline + admin CRUD over HTTP. Pure
 *  factory; the caller supplies the service + port (server.ts). No auth — mirrors
 *  createGitApi; the public submit route is gated by Turnstile in the service.
 *
 *  CORS/origin policy is owned centrally by server.ts's allowlisted `cors()` + `originGuard`
 *  (see app.ts's comment on createGitApi) — this factory no longer sets its own permissive
 *  `cors()`. `POST /forms/submit` is an embeddable public form widget (captcha-gated, no session
 *  cookies read) reachable from ANY origin by design; server.ts's `originGuard` is configured with
 *  `publicPaths: ['/forms/submit']` so that route bypasses the origin check while the admin CRUD
 *  routes below (`/forms/submissions*`, `/forms/forms`) stay behind it (#248). */
export function createFormsApi(opts: {
  submit: SubmissionService
  submissions: SubmissionPort
  captchaStatus?: { provider: string; secretConfigured: boolean }
}): Hono {
  const { submit, submissions } = opts
  const captchaStatus = opts.captchaStatus ?? { provider: '', secretConfigured: false }
  const app = new Hono()

  // --- status (read-only, no secret) ---
  app.get('/forms/captcha-status', (c) => c.json(captchaStatus))

  // --- public ---
  app.post('/forms/submit', async (c) => {
    const body = (await c.req.json()) as {
      formId?: string
      formLabel?: string
      fields?: Record<string, string>
      captchaToken?: string
      honeypot?: string
      source?: { url?: string }
    }
    if (!body.formId || !body.fields || typeof body.captchaToken !== 'string') {
      return c.json({ ok: false, error: 'invalid' }, 400)
    }
    const source = {
      ...(body.source?.url ? { url: body.source.url } : {}),
      ...(c.req.header('referer') ? { referrer: c.req.header('referer') } : {}),
      ...(c.req.header('user-agent') ? { userAgent: c.req.header('user-agent') } : {}),
    }
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? undefined
    const result = await submit.submit({
      formId: body.formId,
      formLabel: body.formLabel,
      fields: body.fields,
      captchaToken: body.captchaToken,
      honeypot: body.honeypot,
      source: Object.keys(source).length ? source : undefined,
      ip,
    })
    if (result.ok) return c.json(result, 200)
    const status = result.error === 'spam' ? 403 : result.error === 'invalid' ? 400 : 500
    return c.json(result, status)
  })

  // --- admin CRUD ---
  app.post('/forms/submissions', async (c) => {
    const body = (await c.req.json()) as Parameters<SubmissionPort['saveSubmission']>[0]
    return c.json(await submissions.saveSubmission(body), 201)
  })

  app.get('/forms/submissions', async (c) => {
    const q = c.req.query()
    const filter: SubmissionFilter = {}
    if (q['formId']) filter.formId = q['formId']
    if (q['read'] === 'true') filter.read = true
    if (q['read'] === 'false') filter.read = false
    if (q['q']) filter.q = q['q']
    if (q['limit']) filter.limit = Number(q['limit'])
    if (q['offset']) filter.offset = Number(q['offset'])
    return c.json(await submissions.listSubmissions(filter))
  })

  app.get('/forms/forms', async (c) => c.json({ forms: await submissions.distinctForms() }))

  app.get('/forms/submissions/:id', async (c) => {
    const row = await submissions.getSubmission(c.req.param('id'))
    return row ? c.json(row) : c.json({ error: 'not found' }, 404)
  })

  app.patch('/forms/submissions/read', async (c) => {
    const { ids, read } = (await c.req.json()) as { ids: string[]; read: boolean }
    await submissions.setRead(ids, read)
    return c.json({ ok: true })
  })

  app.delete('/forms/submissions', async (c) => {
    const { ids } = (await c.req.json()) as { ids: string[] }
    await submissions.deleteSubmissions(ids)
    return c.json({ ok: true })
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
