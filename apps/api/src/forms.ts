import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type {
  Action,
  Actor,
  SubmissionService,
  SubmissionPort,
  SubmissionFilter,
  SubmissionInput
} from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

// c.req.json() returns `any` — untrusted HTTP input flowed straight into typed service
// calls with only truthiness checks (caught by @typescript-eslint/no-unsafe-* when
// type-aware linting came online, #267). These narrow to `unknown`-based shapes and
// fail closed (400) instead. NOTE: proper Zod schemas for this API are the standard
// per docs/security-standards.md ("new input → Zod") — apps/api has no zod dependency
// yet, so that upgrade is deliberately left to a follow-up rather than smuggling a new
// dependency into the linter increment.
const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Capability gate: 403 when the (already-authenticated) actor lacks `action`. Pairs with
 *  `authMiddleware` (which sets the actor / 401s), mirroring media.ts's inline `authz.can` check. */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** A Hono app exposing the forms submit pipeline + admin CRUD over HTTP. Pure
 *  factory; the caller supplies the service + port (server.ts).
 *
 *  Authz (#362, OWASP A01): form submissions contain visitor PII, so the admin CRUD routes are
 *  gated — reads require `forms.view`, mutations `forms.manage` (Maintainer+/Admin per epic #359),
 *  via the same `authMiddleware` + `authz.can` pattern media.ts/users.ts use. The server is the
 *  enforcement boundary; the admin's `useCan` is UX only. The two PUBLIC embed routes are exempt by
 *  design: `POST /forms/submit` is a captcha-gated widget reachable from ANY origin (no session
 *  cookies read — server.ts's `originGuard` lists it in `publicPaths`), and `/forms/captcha-status`
 *  exposes only two booleans, no PII.
 *
 *  CORS/origin policy is owned centrally by server.ts's allowlisted `cors()` + `originGuard`
 *  (see app.ts's comment on createGitApi) — this factory sets none of its own. */
export function createFormsApi(opts: {
  submit: SubmissionService
  submissions: SubmissionPort
  resolveActor: ResolveActor
  captchaStatus?: { provider: string; secretConfigured: boolean }
}) {
  const { submit, submissions, resolveActor } = opts
  const captchaStatus = opts.captchaStatus ?? {
    provider: '',
    secretConfigured: false
  }
  const app = new Hono<{ Variables: { actor: Actor } }>()

  // --- status (read-only, no secret, no PII) ---
  app.get('/forms/captcha-status', (c) => c.json(captchaStatus))

  // --- public (captcha-gated embeddable widget; no session) ---
  app.post('/forms/submit', async (c) => {
    const body = asRecord(await c.req.json())
    if (
      !body ||
      typeof body['formId'] !== 'string' ||
      body['formId'] === '' ||
      !asRecord(body['fields']) ||
      typeof body['captchaToken'] !== 'string'
    ) {
      return c.json({ ok: false, error: 'invalid' }, 400)
    }
    const fields = asRecord(body['fields'])!
    const bodySourceUrl = asRecord(body['source'])?.['url']
    const source = {
      ...(typeof bodySourceUrl === 'string' && bodySourceUrl
        ? { url: bodySourceUrl }
        : {}),
      ...(c.req.header('referer') ? { referrer: c.req.header('referer') } : {}),
      ...(c.req.header('user-agent')
        ? { userAgent: c.req.header('user-agent') }
        : {})
    }
    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for') ??
      undefined
    const result = await submit.submit({
      formId: body['formId'],
      formLabel:
        typeof body['formLabel'] === 'string' ? body['formLabel'] : undefined,
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          typeof v === 'string' ? v : ''
        ])
      ),
      captchaToken: body['captchaToken'],
      honeypot:
        typeof body['honeypot'] === 'string' ? body['honeypot'] : undefined,
      source: Object.keys(source).length ? source : undefined,
      ip
    })
    if (result.ok) return c.json(result, 200)
    const status =
      result.error === 'spam' ? 403 : result.error === 'invalid' ? 400 : 500
    return c.json(result, status)
  })

  // --- admin CRUD — authenticated + capability-gated (visitor PII) ---
  const auth = authMiddleware(resolveActor)
  const canView = requireCan('forms.view')
  const canManage = requireCan('forms.manage')

  app.post('/forms/submissions', auth, canManage, async (c) => {
    const body = asRecord(await c.req.json())
    const fields = asRecord(body?.['fields'])
    if (
      !body ||
      typeof body['formId'] !== 'string' ||
      body['formId'] === '' ||
      !fields
    ) {
      return c.json({ error: 'invalid' }, 400)
    }
    const input: SubmissionInput = {
      formId: body['formId'],
      ...(typeof body['formLabel'] === 'string'
        ? { formLabel: body['formLabel'] }
        : {}),
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          typeof v === 'string' ? v : ''
        ])
      ),
      ...(asRecord(body['source'])
        ? { source: body['source'] as SubmissionInput['source'] }
        : {})
    }
    return c.json(await submissions.saveSubmission(input), 201)
  })

  app.get('/forms/submissions', auth, canView, async (c) => {
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

  app.get('/forms/forms', auth, canView, async (c) =>
    c.json({ forms: await submissions.distinctForms() })
  )

  app.get('/forms/submissions/:id', auth, canView, async (c) => {
    const row = await submissions.getSubmission(c.req.param('id'))
    return row ? c.json(row) : c.json({ error: 'not found' }, 404)
  })

  app.patch('/forms/submissions/read', auth, canManage, async (c) => {
    const body = asRecord(await c.req.json())
    const ids = body?.['ids']
    const read = body?.['read']
    if (!isStringArray(ids) || typeof read !== 'boolean') {
      return c.json({ error: 'invalid' }, 400)
    }
    await submissions.setRead(ids, read)
    return c.json({ ok: true })
  })

  app.delete('/forms/submissions', auth, canManage, async (c) => {
    const body = asRecord(await c.req.json())
    const ids = body?.['ids']
    if (!isStringArray(ids)) {
      return c.json({ error: 'invalid' }, 400)
    }
    await submissions.deleteSubmissions(ids)
    return c.json({ ok: true })
  })

  app.onError((err, c) =>
    c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  )
  return app
}
