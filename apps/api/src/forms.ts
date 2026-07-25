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
import {
  resolveClientIp,
  UNRESOLVED_IP_KEY,
  type ProxyTrust
} from './client-ip'

const authz = createAuthz(DEFAULT_ROLES)

/** Max bytes for a public form submission — one submission is small; this is a DoS ceiling on the
 *  unauthenticated, any-origin submit route (also bounds the ReDoS-prone email input, #340). */
const FORM_SUBMIT_MAX_BYTES = 1 * 1024 * 1024

/**
 * #935 — per-VALUE caps on the unauthenticated submit route.
 *
 * `FORM_SUBMIT_MAX_BYTES` bounds the request; it bounds nothing inside it. Two values escape
 * downstream in ways a whole-body cap cannot reach:
 *
 * - `formLabel` (and `formId`, its fallback) is what the shipped `New submission: {{form_label}}`
 *   subject renders, i.e. an anonymous submitter chose the Subject line of a message the
 *   operator's mail client shows as coming from the site's own from-address. Core now caps the
 *   RENDERED subject too (`capSubject` in packages/core/src/email/template-registry.ts) — that is
 *   the floor under every consumer; this is the boundary check that keeps the oversized value out
 *   of the STORED submission in the first place.
 * - each `fields` entry becomes a row in that email, so with only a 1 MiB whole-body cap a single
 *   submission could carry ~100k rows (the minimum viable JSON for one uniquely-keyed field is
 *   about 9-10 bytes).
 * - `source.url` is not rendered into the email, but it IS persisted verbatim, so the same
 *   whole-body cap was also its only storage bound. 2,000 characters is the de-facto browser URL
 *   limit.
 *
 * What is NOT capped here, and why — stated rather than implied, because "every value is bounded"
 * would be false:
 *
 * - `honeypot` and `captchaToken` come from the same body but are neither stored nor rendered: the
 *   honeypot is only tested for emptiness and the token is handed to the captcha adapter. The
 *   whole-body cap is the right and only bound for them.
 * - `source.referrer` and `source.userAgent` ARE persisted, but they come from request HEADERS
 *   (`referer` / `user-agent`), not the body, so this function never sees them. Their bound is the
 *   server's header limit — 16,384 bytes on Node by default (`http.maxHeaderSize`, verified on the
 *   Node 22 this repo pins), and a platform-imposed limit on the edge topology. That is a real
 *   bound, just not one applied here.
 *
 * 200 characters is far past any real form id or label (the admin UI shows them in a column);
 * 10,000 is far past a contact-form message and still well inside the body cap; 100 fields is far
 * past any form a person fills in. Over-cap → 400 `invalid`, the same answer the route already
 * gives every other malformed body, rather than a silent truncation that would store something
 * the visitor did not send. Pinned by apps/api/test/forms.test.ts ("per-value caps on the public
 * submit route (#935)").
 *
 * Deliberately NOT applied to the authenticated admin CRUD route below: the threat is the
 * anonymous actor, and refusing a maintainer's re-import of a long legitimate submission would be
 * a regression bought for nothing. That route keeps its own 1 MiB body cap.
 */
export const FORM_VALUE_MAX = 200
export const FORM_FIELD_VALUE_MAX = 10_000
export const FORM_FIELD_MAX_COUNT = 100
export const FORM_SOURCE_URL_MAX = 2_000

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
 *  limiter's own Map would be the DoS — see createWindowLimiter's note. 10k live buckets measures
 *  at ~1.6 MiB retained when every one is full (10k IPv4-shaped keys × 5 timestamps, heap delta
 *  under --expose-gc), and is orders of magnitude more distinct sources than a real site sees in
 *  a minute. An earlier version of this comment guessed "a few hundred KiB" without measuring. */
export const DEFAULT_SUBMIT_RATE = {
  max: 5,
  windowMs: 60_000,
  maxKeys: 10_000
} as const

/** #918 review F2: the operator-facing line for the first refusal in a window.
 *
 *  Deliberately shaped around what this module can actually KNOW. It cannot tell a genuine
 *  single-client flood from the zero-config proxy collapse (both look like one busy address), so
 *  it reports the refusal and — only when no proxy is declared — names the collapse as the thing
 *  to rule out. Never claims which one happened. The client address is included because an
 *  operator debugging their own 429s needs it and it is already in every access log; it is an
 *  address, not form PII. Pinned by apps/api/test/forms.test.ts ("reports the first refusal in a
 *  window"). */
function refusalMessage(
  resolved: string | undefined,
  trust: ProxyTrust,
  rate: { max: number; windowMs: number }
): string {
  const who =
    resolved === undefined
      ? 'a caller whose address this topology does not expose (all such callers share ONE bucket)'
      : `client ${resolved}`
  const bound = `${rate.max} per ${Math.round(rate.windowMs / 1000)}s`
  const hint =
    trust.proxies.length === 0
      ? ' If this server sits behind a reverse proxy or CDN, note that SETU_TRUSTED_PROXIES is ' +
        'unset, so every visitor is being keyed on the proxy address — i.e. the whole internet ' +
        'shares one bucket and legitimate visitors will be refused. Set SETU_TRUSTED_PROXIES to ' +
        'the proxy address to key on real visitors.'
      : ''
  return (
    `submit rate limit refused ${who} (bound: ${bound}). Further refusals in this window are ` +
    `not logged.${hint}`
  )
}

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

/** #935: true when every BODY-supplied value that gets stored or rendered is within its cap.
 *  Non-string values are not measured — they are coerced to '' / dropped below, so they carry
 *  nothing. Header-derived `source` fields never reach this function, and `honeypot` /
 *  `captchaToken` are out of scope by design; the constants above say what bounds each instead. */
const withinValueCaps = (
  formId: string,
  formLabel: unknown,
  fields: Record<string, unknown>,
  sourceUrl: unknown
): boolean => {
  if (formId.length > FORM_VALUE_MAX) return false
  if (typeof formLabel === 'string' && formLabel.length > FORM_VALUE_MAX)
    return false
  if (typeof sourceUrl === 'string' && sourceUrl.length > FORM_SOURCE_URL_MAX)
    return false
  const entries = Object.entries(fields)
  if (entries.length > FORM_FIELD_MAX_COUNT) return false
  return entries.every(
    ([k, v]) =>
      k.length <= FORM_VALUE_MAX &&
      (typeof v !== 'string' || v.length <= FORM_FIELD_VALUE_MAX)
  )
}

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
  /** #918: what this deployment has declared about what sits in front of it —
   *  `{ proxies }` from SETU_TRUSTED_PROXIES and the optional `header` from
   *  SETU_TRUSTED_PROXY_HEADER. Empty — the default — means NO forwarded header is believed.
   *  Read the three-level trust model in apps/api/src/client-ip.ts before changing anything
   *  here; in particular, declaring a proxy address does not on its own make a single-valued
   *  header believable, and that separation is load-bearing. */
  proxyTrust?: ProxyTrust
  /** #918: override the submit bound. Defaults to DEFAULT_SUBMIT_RATE; `now` is a test seam. */
  submitRateLimit?: {
    max: number
    windowMs: number
    maxKeys?: number
    now?: () => number
  }
  /** #918 review F2: called with a ready-to-log line the FIRST time the submit bound refuses in
   *  each window (server.ts points it at console.error).
   *
   *  Without it, the accepted zero-config trade in client-ip.ts — a proxied deployment that has
   *  not declared its proxy collapses to one shared bucket — is invisible: 429s are returned to
   *  the caller and nowhere else, so the operator's own visitors would simply start failing
   *  silently. Deduped per window so a sustained flood costs one line, not one per request
   *  (apps/api/test/forms.test.ts, "reports the first refusal in a window"). */
  onSubmitLimited?: (message: string) => void
}) {
  const { submit, submissions, resolveActor } = opts
  const captchaStatus = opts.captchaStatus ?? {
    provider: '',
    secretConfigured: false
  }
  const proxyTrust: ProxyTrust = opts.proxyTrust ?? { proxies: [] }
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
  /** The one trusted reading of who is calling — the bucket key AND (since the #933 review) the
   *  captcha's `remoteip`. `undefined` means the topology exposed no socket peer. Never a value
   *  the request merely claims: see client-ip.ts. */
  const clientIp = (c: Context): string | undefined =>
    resolveClientIp(
      { header: (n) => c.req.header(n), socketIp: opts.socketIp?.(c) },
      proxyTrust
    )
  // Timestamp of the last "we refused someone" report, so a flood costs one line per window.
  let limitReportedAt: number | null = null
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
      const resolved = clientIp(c)
      const key = resolved ?? UNRESOLVED_IP_KEY
      if (!submitLimiter.check(key)) {
        const t = (rate.now ?? Date.now)()
        if (limitReportedAt === null || t - limitReportedAt >= rate.windowMs) {
          limitReportedAt = t
          opts.onSubmitLimited?.(refusalMessage(resolved, proxyTrust, rate))
        }
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
      // #935: bound the values that get STORED or RENDERED, which the whole-body cap does not.
      // Before the captcha call, so a refusal stays the cheapest thing this route can do (same
      // reasoning as the rate limiter above).
      if (
        !withinValueCaps(
          body['formId'],
          body['formLabel'],
          fields,
          bodySourceUrl
        )
      )
        return c.json({ ok: false, error: 'invalid' }, 400)
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
      // #918 — the captcha adapters' optional `remoteip`. It gets the SAME trusted reading the
      // rate limiter keys on (client-ip.ts), never a raw header.
      //
      // The first draft of this sent the raw `cf-connecting-ip` / `x-forwarded-for`, justified by
      // the claim that the verifiers validate remoteip against the address the token was issued
      // to — so a forged value would only break the forger's own submission. That claim was not
      // verified, and it is false. Checked against the current vendor documentation (fetched
      // 2026-07-25):
      //
      //   - Cloudflare Turnstile siteverify documents `remoteip` as optional, described only as
      //     "The visitor's IP address". No matching, no rejection semantics, and no remoteip
      //     error code in its error-codes table.
      //     developers.cloudflare.com/turnstile/get-started/server-side-validation/
      //   - Google reCAPTCHA siteverify documents `remoteip` as "Optional. The user's IP address",
      //     with no validation semantics and no related error code.
      //     developers.google.com/recaptcha/docs/verify
      //   - reCAPTCHA Enterprise's equivalent `Event.userIpAddress` is "Optional. The IP address
      //     in the request from the user's device related to this event" — assessment input.
      //     cloud.google.com/recaptcha/docs/reference/rest/v1/projects.assessments
      //
      // So forging it is not self-harm: at best it is ignored, at worst it feeds risk scoring,
      // in which case an attacker could present a clean address to dodge IP reputation and
      // attribute their solves to a victim's. Passing the trusted reading removes that entirely.
      // The cost is that on a proxied deployment which has not declared its proxy the verifier
      // sees the proxy address — poor risk signal, but no documented rejection, and the same one
      // env var fixes it. Pinned by apps/api/test/forms.test.ts ("hands the captcha the trusted
      // client address, never a forgeable header").
      const captchaIp = clientIp(c)
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
