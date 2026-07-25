import { Hono } from 'hono'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { bodyLimit } from 'hono/body-limit'
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
import { apiOnError } from './errors'
import type { ResolveActor } from './auth/resolve-actor'
import { createWindowLimiter } from './rate-limit'
import { resolveClientIp, UNRESOLVED_IP_KEY } from './client-ip'

const authz = createAuthz(DEFAULT_ROLES)

/** Max bytes for a public form submission — one submission is small; this is a DoS ceiling on the
 *  unauthenticated, any-origin submit route (also bounds the ReDoS-prone email input, #340). */
const FORM_SUBMIT_MAX_BYTES = 1 * 1024 * 1024

/** Max bytes for an authenticated admin CRUD body (#629). These routes were the last unbounded
 *  `c.req.json()` calls in this factory: authentication narrows who can abuse them, it does not
 *  bound what they can send, so one session could still buffer an arbitrary body into memory.
 *  A submission write and an id-list mutation are both small; 1 MiB matches the public cap. */
const FORM_ADMIN_MAX_BYTES = 1 * 1024 * 1024

/** #918: the per-client bound on the unauthenticated submit route. 5 per minute is far above any
 *  human filling in a contact form (including a couple of validation retries) and far below what
 *  makes an open mail relay interesting. Overridable per deployment via
 *  SETU_FORMS_SUBMIT_MAX_PER_WINDOW / SETU_FORMS_SUBMIT_WINDOW_MS (server.ts).
 *
 *  `maxKeys` matters as much as the numbers: the key is a client address, so without a cap the
 *  limiter's own Map would be the DoS — see createWindowLimiter's note. 10k live buckets is a few
 *  hundred KiB and orders of magnitude more distinct sources than a real site sees in a minute. */
export const DEFAULT_SUBMIT_RATE = {
  max: 5,
  windowMs: 60_000,
  maxKeys: 10_000
} as const

/** Cap an admin JSON body before `c.req.json()` parses it. */
const adminBodyLimit = () =>
  bodyLimit({
    maxSize: FORM_ADMIN_MAX_BYTES,
    onError: (c) => c.json({ error: 'too_large' }, 413)
  })

// c.req.json() returns `any` — untrusted HTTP input flowed straight into typed service
// calls with only truthiness checks (caught by @typescript-eslint/no-unsafe-* when
// type-aware linting came online, #267). These narrow to `unknown`-based shapes and
// fail closed (400) instead. NOTE: proper Zod schemas for this API are the standard
// per docs/security-standards.md ("new input → Zod"). The reason originally recorded here
// for deferring that — "apps/api has no zod dependency yet" — is no longer true: apps/api
// depends on zod and capabilities.ts already uses it. The upgrade is #932; this comment used
// to vouch for a deferral whose stated justification had expired (CLAUDE.md §4 #21).
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
  /** #918: the raw TCP peer address of the request, injected because reading it is
   *  topology-specific (server.ts passes `@hono/node-server`'s getConnInfo; a Workers entrypoint
   *  would pass its own, or nothing). Omitted → every submission shares one bucket, which is
   *  over-limiting rather than unlimited. */
  socketIp?: (c: Context) => string | undefined
  /** #918: addresses this deployment's own front proxies connect FROM (SETU_TRUSTED_PROXIES).
   *  Empty — the default — means the forwarded headers are never believed. Read the trust model
   *  in apps/api/src/client-ip.ts before changing anything here. */
  trustedProxies?: readonly string[]
  /** #918: override the submit bound. Defaults to DEFAULT_SUBMIT_RATE; `now` is a test seam. */
  submitRateLimit?: {
    max: number
    windowMs: number
    maxKeys?: number
    now?: () => number
  }
}) {
  const { submit, submissions, resolveActor } = opts
  const captchaStatus = opts.captchaStatus ?? {
    provider: '',
    secretConfigured: false
  }
  const trustedProxies = opts.trustedProxies ?? []
  const rate: {
    max: number
    windowMs: number
    maxKeys?: number
    now?: () => number
  } = opts.submitRateLimit ?? DEFAULT_SUBMIT_RATE
  // On by DEFAULT, not on request: a factory whose bound only exists when the caller remembers to
  // ask for it is one forgotten argument away from the hole this closes
  // (apps/api/test/forms.test.ts, "is on by DEFAULT").
  const submitLimiter = createWindowLimiter({
    max: rate.max,
    windowMs: rate.windowMs,
    maxKeys: rate.maxKeys ?? DEFAULT_SUBMIT_RATE.maxKeys,
    ...(rate.now ? { now: rate.now } : {})
  })
  /** The bucket key: the trusted client address, or ONE shared bucket when the topology exposes
   *  no peer. Never a value the request merely claims — see client-ip.ts. */
  const limiterKey = (c: Context): string =>
    resolveClientIp(
      { header: (n) => c.req.header(n), socketIp: opts.socketIp?.(c) },
      trustedProxies
    ) ?? UNRESOLVED_IP_KEY
  const app = new Hono<{ Variables: { actor: Actor } }>()

  // --- status (read-only, no secret, no PII) ---
  app.get('/forms/captcha-status', (c) => c.json(captchaStatus))

  // --- public (captcha-gated embeddable widget; no session) ---
  app.post(
    '/forms/submit',
    // Ahead of bodyLimit on purpose: a refused request must be the cheapest thing this route can
    // do, so the burst is stopped before a body is buffered, parsed or captcha-verified
    // (apps/api/test/forms.test.ts, "bounds a limited request BEFORE the body is read"). Every
    // ATTEMPT counts, including ones that go on to fail validation or captcha — a limiter that
    // only counted accepted submissions would bound nothing.
    createMiddleware(async (c, next) => {
      const key = limiterKey(c)
      if (!submitLimiter.check(key)) {
        c.header('Retry-After', String(Math.ceil(rate.windowMs / 1000)))
        return c.json(
          { ok: false, error: 'rate_limited', retryAfterMs: rate.windowMs },
          429
        )
      }
      submitLimiter.record(key)
      await next()
    }),
    bodyLimit({
      maxSize: FORM_SUBMIT_MAX_BYTES,
      onError: (c) => c.json({ ok: false, error: 'too_large' }, 413)
    }),
    async (c) => {
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
        ...(c.req.header('referer')
          ? { referrer: c.req.header('referer') }
          : {}),
        ...(c.req.header('user-agent')
          ? { userAgent: c.req.header('user-agent') }
          : {})
      }
      // #918 — TRUST MODEL, read this before reusing these headers for anything else.
      //
      // Both are client-settable: `curl -H 'x-forwarded-for: …'` puts any value here, so NOTHING
      // that must bound an unauthenticated caller may key on them. The rate limiter above
      // deliberately does not — it keys on the socket peer via client-ip.ts, and believes these
      // headers only when the peer is a declared SETU_TRUSTED_PROXIES address.
      //
      // This value is a DIFFERENT thing: the captcha adapters' optional `remoteip`, advisory
      // input to a third-party verifier that fails CLOSED on a mismatch (Turnstile/reCAPTCHA
      // validate it against the address the token was issued to). Sending the forged value only
      // makes the forger's own submission fail verification, so it is safe here and — unlike the
      // socket peer — it is still the visitor's real address behind an as-yet-undeclared CDN,
      // which is what keeps captcha working on a zero-config proxied deployment. Header first,
      // socket peer as the fallback. `x-forwarded-for` is a list; remoteip takes one address, so
      // the leftmost (conventionally the original client) is what goes over, not the whole chain.
      const forwardedFor = c.req
        .header('x-forwarded-for')
        ?.split(',')[0]
        ?.trim()
      const captchaIp =
        c.req.header('cf-connecting-ip') ??
        (forwardedFor !== '' ? forwardedFor : undefined) ??
        opts.socketIp?.(c)
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
        ip: captchaIp
      })
      if (result.ok) return c.json(result, 200)
      const status =
        result.error === 'spam' ? 403 : result.error === 'invalid' ? 400 : 500
      return c.json(result, status)
    }
  )

  // --- admin CRUD — authenticated + capability-gated (visitor PII) ---
  const auth = authMiddleware(resolveActor)
  const canView = requireCan('forms.view')
  const canManage = requireCan('forms.manage')

  app.post(
    '/forms/submissions',
    adminBodyLimit(),
    auth,
    canManage,
    async (c) => {
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
    }
  )

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

  app.patch(
    '/forms/submissions/read',
    adminBodyLimit(),
    auth,
    canManage,
    async (c) => {
      const body = asRecord(await c.req.json())
      const ids = body?.['ids']
      const read = body?.['read']
      if (!isStringArray(ids) || typeof read !== 'boolean') {
        return c.json({ error: 'invalid' }, 400)
      }
      await submissions.setRead(ids, read)
      return c.json({ ok: true })
    }
  )

  app.delete(
    '/forms/submissions',
    adminBodyLimit(),
    auth,
    canManage,
    async (c) => {
      const body = asRecord(await c.req.json())
      const ids = body?.['ids']
      if (!isStringArray(ids)) {
        return c.json({ error: 'invalid' }, 400)
      }
      await submissions.deleteSubmissions(ids)
      return c.json({ ok: true })
    }
  )

  app.onError(apiOnError({ scope: 'forms' })) // #291: prod-generic, never err.message
  return app
}
