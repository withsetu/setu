import { describe, it, expect, vi } from 'vitest'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import type { Actor, Role } from '@setu/core'
import {
  createFormsApi,
  DEFAULT_SUBMIT_RATE,
  FORM_FIELD_MAX_COUNT,
  FORM_FIELD_VALUE_MAX,
  FORM_SOURCE_URL_MAX,
  FORM_VALUE_MAX
} from '../src/forms'
import { createNotifyCeiling } from '../src/rate-limit'
import type { ResolveActor } from '../src/auth/resolve-actor'

// Default resolver acts as an admin so the pre-existing behavioural tests still exercise the CRUD
// as an authorized caller. The gating tests below pass their own role-specific / null resolvers.
const asRole =
  (role: Role): ResolveActor =>
  () =>
    ({ id: 'u', role }) satisfies Actor
const unauthenticated: ResolveActor = () => null

function makeApp(opts?: {
  verify?: () => Promise<boolean>
  resolveActor?: ResolveActor
}) {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({
    submissions,
    captcha: { verify: opts?.verify ?? (async () => true) }
  })
  const app = createFormsApi({
    submit,
    submissions,
    resolveActor: opts?.resolveActor ?? asRole('admin')
  })
  return { app, submissions }
}

const post = (
  app: ReturnType<typeof createFormsApi>,
  path: string,
  body: unknown,
  method = 'POST'
) =>
  app.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  )

// #419 — /forms/submit is PUBLIC (any origin, no auth — publicPaths in server.ts), so an unbounded
// c.req.json() here is an unauthenticated DoS surface that also amplifies the ReDoS on email input
// (#340). The route now caps the body; oversize → 413 before any parsing/verification.
describe('createFormsApi — public submit body cap (413)', () => {
  it('rejects an oversized /forms/submit body with 413', async () => {
    const { app } = makeApp()
    const oversize =
      '{"formId":"contact","captchaToken":"t","fields":{"message":"' +
      'a'.repeat(1024 * 1024 + 1024) +
      '"}}'
    const res = await app.fetch(
      new Request('http://x/forms/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversize
      })
    )
    expect(res.status).toBe(413)
  })
})

// #935. The 1 MiB body cap above bounds the REQUEST; it bounds no single value inside it. An
// anonymous submitter could therefore hand `formLabel` a ~1 MiB string, which the shipped
// `New submission: {{form_label}}` subject puts straight into a mail header, and hand `fields`
// half a million entries, each of which becomes a row in the notification email. The rendered
// subject is now capped in core as well (packages/core/test/email/email-registry.test.ts) — this
// is the other half: bound the values where they ENTER, so nothing downstream has to.
describe('createFormsApi — per-value caps on the public submit route (#935)', () => {
  const valid = { email: 'a@x.com', message: 'hi there' }

  // KILL-SHOT TARGET. Remove the cap `.refine()`s from `fieldsSchema` / `optionalCapped` /
  // `submitBodySchema.source` in forms.ts and each of these stores a submission (200) instead of
  // being refused. (Before #932 the same guard was a hand-rolled `withinValueCaps` helper; the
  // caps and their inclusive boundaries are unchanged.)
  it.each([
    ['formId', { formId: 'c'.repeat(FORM_VALUE_MAX + 1), fields: valid }],
    [
      'formLabel',
      {
        formId: 'contact',
        formLabel: 'L'.repeat(FORM_VALUE_MAX + 1),
        fields: valid
      }
    ],
    [
      'a field name',
      {
        formId: 'contact',
        fields: { ...valid, ['n'.repeat(FORM_VALUE_MAX + 1)]: 'x' }
      }
    ],
    [
      'a field value',
      {
        formId: 'contact',
        fields: { ...valid, note: 'v'.repeat(FORM_FIELD_VALUE_MAX + 1) }
      }
    ],
    [
      'the field count',
      {
        formId: 'contact',
        fields: {
          ...valid,
          ...Object.fromEntries(
            Array.from({ length: FORM_FIELD_MAX_COUNT - 1 }, (_, i) => [
              `f${i}`,
              'x'
            ])
          )
        }
      }
    ],
    [
      'a source url',
      {
        formId: 'contact',
        fields: valid,
        source: { url: `https://x.test/${'u'.repeat(FORM_SOURCE_URL_MAX)}` }
      }
    ]
  ])('refuses an oversized %s with 400', async (_what, body) => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submit', {
      ...body,
      captchaToken: 'tok'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  // The caps are INCLUSIVE. Asserted at the exact boundary, including the field COUNT — which the
  // refusal case above cannot reach, since it can only prove that count+1 is refused.
  it('accepts values sitting exactly at their caps', async () => {
    const { app } = makeApp()
    const fields: Record<string, string> = {
      ...valid,
      note: 'v'.repeat(FORM_FIELD_VALUE_MAX)
    }
    fields['n'.repeat(FORM_VALUE_MAX)] = 'x'
    while (Object.keys(fields).length < FORM_FIELD_MAX_COUNT)
      fields[`f${Object.keys(fields).length}`] = 'x'
    expect(Object.keys(fields)).toHaveLength(FORM_FIELD_MAX_COUNT)
    const res = await post(app, '/forms/submit', {
      formId: 'c'.repeat(FORM_VALUE_MAX),
      formLabel: 'L'.repeat(FORM_VALUE_MAX),
      fields,
      source: { url: `https://x.test/${'u'.repeat(FORM_SOURCE_URL_MAX - 15)}` },
      captchaToken: 'tok'
    })
    expect(res.status).toBe(200)
  })
})

describe('createFormsApi', () => {
  it('POST /forms/submit stores a valid submission', async () => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submit', {
      formId: 'contact',
      fields: { email: 'a@x.com', message: 'hi there' },
      captchaToken: 'tok'
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('POST /forms/submit returns 403 on captcha failure', async () => {
    const { app } = makeApp({ verify: async () => false })
    const res = await post(app, '/forms/submit', {
      formId: 'c',
      fields: { email: 'a@x.com', message: 'x' },
      captchaToken: 't'
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: 'spam' })
  })

  it('POST /forms/submit returns 400 on invalid', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submit', {
      formId: 'c',
      fields: { email: 'bad', message: '' },
      captchaToken: 't'
    })
    expect(res.status).toBe(400)
  })

  it('POST /forms/submit returns 400 when formId is missing or empty', async () => {
    const { app } = makeApp()
    const missing = await post(app, '/forms/submit', {
      fields: { email: 'a@x.com', message: 'hi' },
      captchaToken: 't'
    })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ ok: false, error: 'invalid' })

    const empty = await post(app, '/forms/submit', {
      formId: '',
      fields: { email: 'a@x.com', message: 'hi' },
      captchaToken: 't'
    })
    expect(empty.status).toBe(400)
  })

  it('POST /forms/submit returns 400 for a non-object body', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submit', 'just a string')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid' })
  })

  it('POST /forms/submit coerces non-string field values to empty strings instead of storing them raw', async () => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submit', {
      formId: 'contact',
      fields: {
        email: 'a@x.com',
        message: 'hi there',
        age: 42,
        meta: { nested: true },
        tags: ['a', 'b']
      },
      captchaToken: 'tok'
    })
    expect(res.status).toBe(200)
    const stored = (await submissions.listSubmissions()).rows[0]!
    expect(stored.fields['age']).toBe('')
    expect(stored.fields['meta']).toBe('')
    expect(stored.fields['tags']).toBe('')
    expect(stored.fields['email']).toBe('a@x.com')
    expect(stored.fields['message']).toBe('hi there')
  })

  it('POST /forms/submissions returns 400 when formId or fields are missing/invalid', async () => {
    const { app } = makeApp()
    const noFormId = await post(app, '/forms/submissions', {
      fields: { email: 'a@x.com', message: 'one' }
    })
    expect(noFormId.status).toBe(400)
    expect(await noFormId.json()).toEqual({ error: 'invalid' })

    const emptyFormId = await post(app, '/forms/submissions', {
      formId: '',
      fields: { email: 'a@x.com', message: 'one' }
    })
    expect(emptyFormId.status).toBe(400)

    const noFields = await post(app, '/forms/submissions', {
      formId: 'contact'
    })
    expect(noFields.status).toBe(400)

    const nonObjectBody = await post(app, '/forms/submissions', 42)
    expect(nonObjectBody.status).toBe(400)
  })

  it('POST /forms/submissions coerces non-string field values to empty strings', async () => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submissions', {
      formId: 'contact',
      fields: { email: 'a@x.com', count: 7, obj: { a: 1 }, arr: [1, 2] }
    })
    expect(res.status).toBe(201)
    const saved = (await res.json()) as { fields: Record<string, string> }
    expect(saved.fields['count']).toBe('')
    expect(saved.fields['obj']).toBe('')
    expect(saved.fields['arr']).toBe('')
    expect(saved.fields['email']).toBe('a@x.com')
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('PATCH /forms/submissions/read returns 400 for a non-object body', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submissions/read', 'nope', 'PATCH')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid' })
  })

  it('DELETE /forms/submissions returns 400 for a non-object body', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submissions', 'nope', 'DELETE')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid' })
  })

  it('GET /forms/submissions lists with filters; GET /forms/forms summarizes', async () => {
    const { app, submissions } = makeApp()
    await submissions.saveSubmission({
      formId: 'contact',
      formLabel: 'Contact',
      fields: { email: 'a@x.com', message: 'one' }
    })
    await submissions.saveSubmission({
      formId: 'apply',
      formLabel: 'Apply',
      fields: { email: 'b@x.com', message: 'two' }
    })
    const list = (await (
      await app.fetch(new Request('http://x/forms/submissions?formId=contact'))
    ).json()) as { total: number }
    expect(list.total).toBe(1)
    const forms = (await (
      await app.fetch(new Request('http://x/forms/forms'))
    ).json()) as { forms: unknown[] }
    expect(forms.forms).toEqual([
      { formId: 'apply', formLabel: 'Apply', count: 1 },
      { formId: 'contact', formLabel: 'Contact', count: 1 }
    ])
  })

  it('GET /forms/captcha-status returns provider + secretConfigured booleans', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({
      submissions,
      captcha: { verify: async () => true }
    })
    const app = createFormsApi({
      submit,
      submissions,
      resolveActor: asRole('admin'),
      captchaStatus: { provider: 'turnstile', secretConfigured: true }
    })
    const res = await app.fetch(new Request('http://x/forms/captcha-status'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      provider: 'turnstile',
      secretConfigured: true
    })
  })

  it('GET /forms/captcha-status defaults to none when no status is supplied', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({
      submissions,
      captcha: { verify: async () => true }
    })
    const app = createFormsApi({
      submit,
      submissions,
      resolveActor: asRole('admin')
    })
    expect(
      await (
        await app.fetch(new Request('http://x/forms/captcha-status'))
      ).json()
    ).toEqual({
      provider: '',
      secretConfigured: false
    })
  })

  it('PATCH read and DELETE work', async () => {
    const { app, submissions } = makeApp()
    const s = await submissions.saveSubmission({
      formId: 'c',
      fields: { email: 'a@x.com', message: 'x' }
    })
    expect(
      (
        await post(
          app,
          '/forms/submissions/read',
          { ids: [s.id], read: true },
          'PATCH'
        )
      ).status
    ).toBe(200)
    expect((await submissions.getSubmission(s.id))!.read).toBe(true)
    expect(
      (await post(app, '/forms/submissions', { ids: [s.id] }, 'DELETE')).status
    ).toBe(200)
    expect(await submissions.getSubmission(s.id)).toBeNull()
  })
})

// #918 layer 2 — /forms/submit is unauthenticated and reachable from any origin, and each accepted
// submission fires one real email.send. The per-IP bound is the REFINEMENT (the caller-independent
// notification ceiling in rate-limit.ts is the guarantee), and its whole value depends on keying on
// something the caller cannot forge — see apps/api/src/client-ip.ts for the trust model.
describe('createFormsApi — per-IP submit rate limit (#918)', () => {
  const valid = {
    formId: 'contact',
    fields: { email: 'a@x.com', message: 'hello there' },
    captchaToken: 't'
  }
  const submitFrom = (
    app: ReturnType<typeof createFormsApi>,
    headers: Record<string, string> = {}
  ) =>
    app.fetch(
      new Request('http://x/forms/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(valid)
      })
    )

  const limited = (opts?: {
    socketIp?: (() => string | undefined) | undefined
    trustedProxies?: string[]
    trustedProxyHeader?: string
    max?: number
    onSubmitLimited?: (m: string) => void
  }) => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({
      submissions,
      captcha: { verify: async () => true }
    })
    const app = createFormsApi({
      submit,
      submissions,
      resolveActor: unauthenticated,
      socketIp: opts?.socketIp ?? (() => '203.0.113.9'),
      proxyTrust: {
        proxies: opts?.trustedProxies ?? [],
        ...(opts?.trustedProxyHeader ? { header: opts.trustedProxyHeader } : {})
      },
      submitRateLimit: { max: opts?.max ?? 3, windowMs: 60_000, now: () => 0 },
      ...(opts?.onSubmitLimited
        ? { onSubmitLimited: opts.onSubmitLimited }
        : {})
    })
    return { app, submissions }
  }

  it('accepts up to the cap from one client, then 429s the burst', async () => {
    const { app, submissions } = limited({ max: 3 })
    const codes: number[] = []
    for (let i = 0; i < 5; i++) codes.push((await submitFrom(app)).status)
    expect(codes).toEqual([200, 200, 200, 429, 429])
    expect((await submissions.listSubmissions()).total).toBe(3)
  })

  it('answers a limited caller honestly: an error code and a Retry-After', async () => {
    const { app } = limited({ max: 1 })
    await submitFrom(app)
    const res = await submitFrom(app)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'rate_limited',
      retryAfterMs: 60_000
    })
    expect(res.headers.get('retry-after')).toBe('60')
  })

  // THE forgery case. Under the default (no declared proxies) the headers are not read at all, so
  // no value a caller puts in them can mint fresh quota. Kill-shot: trust the header
  // unconditionally in client-ip.ts and this test fails.
  it('a forged x-forwarded-for cannot mint fresh quota under the default (untrusted) config', async () => {
    const { app, submissions } = limited({ max: 2 })
    const codes: number[] = []
    for (let i = 0; i < 5; i++)
      codes.push(
        (await submitFrom(app, { 'x-forwarded-for': `10.0.0.${i}` })).status
      )
    expect(codes).toEqual([200, 200, 429, 429, 429])
    expect((await submissions.listSubmissions()).total).toBe(2)
  })

  it('a forged cf-connecting-ip cannot mint fresh quota either', async () => {
    const { app } = limited({ max: 2 })
    const codes: number[] = []
    for (let i = 0; i < 4; i++)
      codes.push(
        (await submitFrom(app, { 'cf-connecting-ip': `10.0.0.${i}` })).status
      )
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('separates genuinely distinct socket peers', async () => {
    let peer = '203.0.113.1'
    const { app } = limited({ max: 1, socketIp: () => peer })
    expect((await submitFrom(app)).status).toBe(200)
    expect((await submitFrom(app)).status).toBe(429)
    peer = '203.0.113.2'
    expect((await submitFrom(app)).status).toBe(200)
  })

  it('DOES separate forwarded clients once the deployment declares its proxy', async () => {
    const { app } = limited({
      max: 1,
      socketIp: () => '198.51.100.1',
      trustedProxies: ['198.51.100.1']
    })
    expect(
      (await submitFrom(app, { 'x-forwarded-for': '1.2.3.4' })).status
    ).toBe(200)
    expect(
      (await submitFrom(app, { 'x-forwarded-for': '1.2.3.4' })).status
    ).toBe(429)
    expect(
      (await submitFrom(app, { 'x-forwarded-for': '5.6.7.8' })).status
    ).toBe(200)
  })

  // THE review finding (PR #933, F1), at the route level. Declaring the proxy ADDRESS is the
  // config an operator adds precisely to get working per-IP limiting; it must not simultaneously
  // hand every caller a fresh bucket per request through a header a generic reverse proxy
  // forwards verbatim. Kill-shot: believe cf-connecting-ip from any declared proxy in
  // client-ip.ts and this test fails.
  it('a forged cf-connecting-ip cannot mint fresh quota through a DECLARED non-Cloudflare proxy', async () => {
    const { app, submissions } = limited({
      max: 2,
      socketIp: () => '127.0.0.1', // a local nginx/Caddy/Traefik front
      trustedProxies: ['127.0.0.1']
    })
    const codes: number[] = []
    for (let i = 0; i < 5; i++) {
      codes.push(
        (
          await submitFrom(app, {
            'x-forwarded-for': '203.0.113.7', // what the proxy actually set
            'cf-connecting-ip': `9.9.9.${i}` // what the attacker added
          })
        ).status
      )
    }
    expect(codes).toEqual([200, 200, 429, 429, 429])
    expect((await submissions.listSubmissions()).total).toBe(2)
  })

  it('believes the single-valued header only once SETU_TRUSTED_PROXY_HEADER declares it', async () => {
    const { app } = limited({
      max: 1,
      socketIp: () => '198.51.100.1',
      trustedProxies: ['198.51.100.1'],
      trustedProxyHeader: 'cf-connecting-ip'
    })
    expect(
      (await submitFrom(app, { 'cf-connecting-ip': '1.2.3.4' })).status
    ).toBe(200)
    expect(
      (await submitFrom(app, { 'cf-connecting-ip': '1.2.3.4' })).status
    ).toBe(429)
    expect(
      (await submitFrom(app, { 'cf-connecting-ip': '5.6.7.8' })).status
    ).toBe(200)
  })

  // Fail-closed: a topology that exposes no socket peer must still be bounded. One shared bucket
  // is over-limiting, which is the safe direction; "no IP → no limit" is the unsafe one.
  it('falls back to ONE shared bucket when no socket peer is available', async () => {
    const { app } = limited({ max: 2, socketIp: () => undefined })
    const codes: number[] = []
    for (let i = 0; i < 4; i++)
      codes.push(
        (await submitFrom(app, { 'x-forwarded-for': `10.0.0.${i}` })).status
      )
    expect(codes).toEqual([200, 200, 429, 429])
  })

  it('counts REJECTED attempts too — a limiter that only counts successes bounds nothing', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({
      submissions,
      captcha: { verify: async () => false } // every submission is refused as spam
    })
    const app = createFormsApi({
      submit,
      submissions,
      resolveActor: unauthenticated,
      socketIp: () => '203.0.113.9',
      submitRateLimit: { max: 2, windowMs: 60_000, now: () => 0 }
    })
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await submitFrom(app)).status)
    expect(codes).toEqual([403, 403, 429, 429])
  })

  it('leaves the admin CRUD routes and captcha-status unlimited', async () => {
    const { app, submissions } = limited({ max: 1 })
    await submitFrom(app)
    for (let i = 0; i < 5; i++) {
      expect(
        (await app.fetch(new Request('http://x/forms/captcha-status'))).status
      ).toBe(200)
    }
    const admin = createFormsApi({
      submit: createSubmissionService({
        submissions,
        captcha: { verify: async () => true }
      }),
      submissions,
      resolveActor: asRole('admin'),
      submitRateLimit: { max: 1, windowMs: 60_000, now: () => 0 }
    })
    for (let i = 0; i < 5; i++) {
      expect(
        (await admin.fetch(new Request('http://x/forms/submissions'))).status
      ).toBe(200)
    }
  })

  it('refills as the window slides', async () => {
    let t = 0
    const submissions = createMemorySubmissionPort()
    const app = createFormsApi({
      submit: createSubmissionService({
        submissions,
        captcha: { verify: async () => true }
      }),
      submissions,
      resolveActor: unauthenticated,
      socketIp: () => '203.0.113.9',
      submitRateLimit: { max: 1, windowMs: 1_000, now: () => t }
    })
    expect((await submitFrom(app)).status).toBe(200)
    expect((await submitFrom(app)).status).toBe(429)
    t = 1_000
    expect((await submitFrom(app)).status).toBe(200)
  })

  it('bounds a limited request BEFORE the body is read', async () => {
    // A 429 must be cheaper than a 413: the point of limiting an unauthenticated route is to stop
    // spending on the burst, and buffering a megabyte first would defeat it.
    const { app } = limited({ max: 1 })
    await submitFrom(app)
    const res = await app.fetch(
      new Request('http://x/forms/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(50 * 1024 * 1024)
        },
        body: '{}'
      })
    )
    expect(res.status).toBe(429)
  })

  // #918 review F2 — the zero-config collapse-to-one-bucket trade is only acceptable if the
  // operator can NOTICE it. A 429 goes to the caller and nowhere else, so without this the
  // operator's own visitors would start failing silently.
  describe('reports the first refusal in a window', () => {
    it('logs once per window, not once per refused request', async () => {
      const seen: string[] = []
      const { app } = limited({ max: 1, onSubmitLimited: (m) => seen.push(m) })
      await submitFrom(app) // consumes the only slot
      for (let i = 0; i < 10; i++)
        expect((await submitFrom(app)).status).toBe(429)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain('submit rate limit refused')
      expect(seen[0]).toContain('203.0.113.9')
    })

    it('names the undeclared-proxy collapse as the thing to rule out when no proxy is declared', async () => {
      const seen: string[] = []
      const { app } = limited({ max: 1, onSubmitLimited: (m) => seen.push(m) })
      await submitFrom(app)
      await submitFrom(app)
      expect(seen[0]).toContain('SETU_TRUSTED_PROXIES')
      expect(seen[0]).toContain('one bucket')
    })

    it('drops that hint once a proxy IS declared — the collapse cannot be the cause then', async () => {
      const seen: string[] = []
      const { app } = limited({
        max: 1,
        socketIp: () => '127.0.0.1',
        trustedProxies: ['127.0.0.1'],
        onSubmitLimited: (m) => seen.push(m)
      })
      await submitFrom(app, { 'x-forwarded-for': '203.0.113.7' })
      await submitFrom(app, { 'x-forwarded-for': '203.0.113.7' })
      expect(seen).toHaveLength(1)
      expect(seen[0]).not.toContain('SETU_TRUSTED_PROXIES')
      expect(seen[0]).toContain('203.0.113.7')
    })

    it('says so explicitly when the topology exposes no peer at all', async () => {
      const seen: string[] = []
      const { app } = limited({
        max: 1,
        socketIp: () => undefined,
        onSubmitLimited: (m) => seen.push(m)
      })
      await submitFrom(app)
      await submitFrom(app)
      expect(seen[0]).toContain('does not expose')
      expect(seen[0]).toContain('ONE bucket')
    })

    it('stays silent while nothing is being refused', async () => {
      const seen: string[] = []
      const { app } = limited({ max: 5, onSubmitLimited: (m) => seen.push(m) })
      for (let i = 0; i < 5; i++)
        expect((await submitFrom(app)).status).toBe(200)
      expect(seen).toEqual([])
    })
  })

  // #918 review F3 — the captcha's remoteip gets the SAME trusted reading the limiter keys on.
  // No vendor documents remoteip validation (see the citation block at the call site), so a
  // forged value is not self-harm: it is either ignored or feeds risk scoring, where a clean
  // forged address helps the attacker and blames a victim.
  describe('hands the captcha the trusted client address, never a forgeable header', () => {
    const captchaSpy = () => {
      const seen: (string | undefined)[] = []
      return {
        seen,
        captcha: {
          verify: async (_t: string, ip?: string) => {
            seen.push(ip)
            return true
          }
        }
      }
    }

    const drive = async (
      trustedProxies: string[],
      headers: Record<string, string>,
      socketIp = '203.0.113.9'
    ) => {
      const { seen, captcha } = captchaSpy()
      const submissions = createMemorySubmissionPort()
      const app = createFormsApi({
        submit: createSubmissionService({ submissions, captcha }),
        submissions,
        resolveActor: unauthenticated,
        socketIp: () => socketIp,
        proxyTrust: { proxies: trustedProxies }
      })
      await submitFrom(app, headers)
      return seen
    }

    it('sends the socket peer, not a forged cf-connecting-ip, with no proxy declared', async () => {
      expect(
        await drive([], {
          'cf-connecting-ip': '9.9.9.9',
          'x-forwarded-for': '8.8.8.8'
        })
      ).toEqual(['203.0.113.9'])
    })

    it('sends the proxy-reported client once a proxy IS declared', async () => {
      expect(
        await drive(
          ['127.0.0.1'],
          { 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '9.9.9.9' },
          '127.0.0.1'
        )
      ).toEqual(['203.0.113.7'])
    })

    it('is the same value the limiter keys on, so the two cannot disagree', async () => {
      // A forged header changes neither. If they ever diverged, one of them would be reading a
      // claim rather than the resolved address.
      const withForgery = await drive([], { 'cf-connecting-ip': '1.1.1.1' })
      const without = await drive([], {})
      expect(withForgery).toEqual(without)
    })
  })

  it('is on by DEFAULT — a caller that configures nothing still gets a bound', async () => {
    // The factory must not need server.ts to remember. Defaults live in forms.ts.
    const submissions = createMemorySubmissionPort()
    const app = createFormsApi({
      submit: createSubmissionService({
        submissions,
        captcha: { verify: async () => true }
      }),
      submissions,
      resolveActor: unauthenticated,
      socketIp: () => '203.0.113.9'
    })
    const codes: number[] = []
    for (let i = 0; i < DEFAULT_SUBMIT_RATE.max + 2; i++)
      codes.push((await submitFrom(app)).status)
    expect(codes.filter((s) => s === 429)).toHaveLength(2)
  })
})

// #918 layer 1 — the point of the ceiling is that it holds when layer 2 does NOT. This drives the
// whole path (route → service → email port) with the per-IP limiter set so wide it never fires AND
// the caller varying its socket address every request, which is exactly the shape that defeats any
// per-identity bound. The mail still stops; the submissions still land.
describe('createFormsApi — the notification ceiling binds independently (#918)', () => {
  // The other direction, and the one that matters most: none of #918's bounds may touch the
  // ordinary case. One visitor, one form, one email.
  it('leaves a single legitimate submission alone — it persists AND delivers', async () => {
    const submissions = createMemorySubmissionPort()
    const send = vi.fn(async () => {})
    const skips: string[] = []
    const app = createFormsApi({
      submit: createSubmissionService({
        submissions,
        captcha: { verify: async () => true },
        email: { send },
        notifyTo: 'owner@x.com',
        notifyFrom: 'site@x.com',
        onNotifySkipped: (r) => skips.push(r),
        allowNotification: createNotifyCeiling({ max: 20, windowMs: 600_000 })
      }),
      submissions,
      resolveActor: unauthenticated,
      socketIp: () => '203.0.113.9'
    })

    const res = await app.fetch(
      new Request('http://x/forms/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          formId: 'contact',
          fields: { email: 'visitor@example.com', message: 'hello there' },
          captchaToken: 't'
        })
      })
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(skips).toEqual([])
  })

  it('bounds MAIL, not submissions, when the per-IP limiter is out of the way and the IP varies', async () => {
    const submissions = createMemorySubmissionPort()
    const send = vi.fn(async () => {})
    const skips: string[] = []
    let peer = 0
    const app = createFormsApi({
      submit: createSubmissionService({
        submissions,
        captcha: { verify: async () => true },
        email: { send },
        notifyTo: 'owner@x.com',
        notifyFrom: 'site@x.com',
        onNotifySkipped: (r) => skips.push(r),
        allowNotification: createNotifyCeiling({
          max: 3,
          windowMs: 10 * 60_000,
          now: () => 0
        })
      }),
      submissions,
      resolveActor: unauthenticated,
      socketIp: () => `203.0.113.${peer}`,
      // Effectively disabled: layer 2 must contribute nothing to this result.
      submitRateLimit: { max: 1_000, windowMs: 60_000, now: () => 0 }
    })

    for (peer = 0; peer < 10; peer++) {
      const res = await app.fetch(
        new Request('http://x/forms/submit', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': `10.0.0.${peer}`
          },
          body: JSON.stringify({
            formId: 'contact',
            fields: { email: 'a@x.com', message: 'hello there' },
            captchaToken: 't'
          })
        })
      )
      expect(res.status).toBe(200)
    }

    expect(send).toHaveBeenCalledTimes(3) // the ceiling, unmoved by 10 distinct addresses
    expect(skips).toHaveLength(7)
    expect(skips[0]).toContain('ceiling')
    expect(skips[0]).toContain('the submission was saved')
    // And not one genuine submission was lost to the bound.
    expect((await submissions.listSubmissions()).total).toBe(10)
  })
})

// #362 — the Forms-submissions API carries visitor PII and had NO authz gate (OWASP A01). Every
// admin CRUD route now requires an authenticated actor with the matching capability: reads need
// `forms.view`, mutations need `forms.manage` (Maintainer+/Admin per epic #359). The public embed
// routes (`/forms/submit`, `/forms/captcha-status`) stay open by design.
describe('createFormsApi — authz enforcement (#362, the PII hole)', () => {
  const READ_ROUTES: Array<[string, RequestInit]> = [
    ['/forms/submissions', { method: 'GET' }],
    ['/forms/submissions/some-id', { method: 'GET' }],
    ['/forms/forms', { method: 'GET' }]
  ]
  const WRITE_ROUTES: Array<[string, RequestInit]> = [
    [
      '/forms/submissions',
      { method: 'POST', body: JSON.stringify({ formId: 'c', fields: {} }) }
    ],
    [
      '/forms/submissions/read',
      { method: 'PATCH', body: JSON.stringify({ ids: ['x'], read: true }) }
    ],
    [
      '/forms/submissions',
      { method: 'DELETE', body: JSON.stringify({ ids: ['x'] }) }
    ]
  ]
  const call = (
    app: ReturnType<typeof createFormsApi>,
    path: string,
    init: RequestInit
  ) =>
    app.fetch(
      new Request(`http://x${path}`, {
        ...init,
        headers: { 'content-type': 'application/json' }
      })
    )

  it('rejects an UNAUTHENTICATED caller with 401 on every admin CRUD route', async () => {
    const { app } = makeApp({ resolveActor: unauthenticated })
    for (const [path, init] of [...READ_ROUTES, ...WRITE_ROUTES]) {
      expect(
        (await call(app, path, init)).status,
        `${init.method} ${path}`
      ).toBe(401)
    }
  })

  it('rejects an AUTHOR (no forms.* capability) with 403 on every admin CRUD route', async () => {
    // #379: author is the lowest staff role and holds no forms.* — form PII is Maintainer+ only.
    const { app } = makeApp({ resolveActor: asRole('author') })
    for (const [path, init] of [...READ_ROUTES, ...WRITE_ROUTES]) {
      expect(
        (await call(app, path, init)).status,
        `${init.method} ${path}`
      ).toBe(403)
    }
  })

  it('rejects an EDITOR (content role, no forms.*) with 403 — form PII is Maintainer+ only', async () => {
    const { app } = makeApp({ resolveActor: asRole('editor') })
    for (const [path, init] of [...READ_ROUTES, ...WRITE_ROUTES]) {
      expect(
        (await call(app, path, init)).status,
        `${init.method} ${path}`
      ).toBe(403)
    }
  })

  it('allows a MAINTAINER to read and manage submissions', async () => {
    const { app, submissions } = makeApp({ resolveActor: asRole('maintainer') })
    const s = await submissions.saveSubmission({
      formId: 'c',
      fields: { email: 'a@x.com', message: 'x' }
    })
    expect(
      (await call(app, '/forms/submissions', { method: 'GET' })).status
    ).toBe(200)
    expect(
      (await call(app, `/forms/submissions/${s.id}`, { method: 'GET' })).status
    ).toBe(200)
    expect(
      (
        await call(app, '/forms/submissions/read', {
          method: 'PATCH',
          body: JSON.stringify({ ids: [s.id], read: true })
        })
      ).status
    ).toBe(200)
    expect(
      (
        await call(app, '/forms/submissions', {
          method: 'DELETE',
          body: JSON.stringify({ ids: [s.id] })
        })
      ).status
    ).toBe(200)
  })

  it('keeps the public embed routes open (no session needed)', async () => {
    const { app } = makeApp({ resolveActor: unauthenticated })
    expect(
      (await call(app, '/forms/captcha-status', { method: 'GET' })).status
    ).toBe(200)
    const submit = await call(app, '/forms/submit', {
      method: 'POST',
      body: JSON.stringify({
        formId: 'contact',
        fields: { email: 'a@x.com', message: 'hello there' },
        captchaToken: 't'
      })
    })
    expect(submit.status).toBe(200)
  })
})

// #629 — the admin CRUD routes parsed `c.req.json()` with no cap. They're authenticated, but a
// single compromised/lazy editor session could OOM the process; the public submit route has been
// capped since #419 and these are the remaining unbounded JSON bodies in this factory.
describe('createFormsApi — admin CRUD body caps (#629)', () => {
  const oversize = (
    app: ReturnType<typeof createFormsApi>,
    path: string,
    method: string
  ) =>
    app.fetch(
      new Request(`http://x${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': String(50 * 1024 * 1024)
        },
        body: '{}'
      })
    )

  it('413s an oversized POST /forms/submissions', async () => {
    const { app } = makeApp()
    expect((await oversize(app, '/forms/submissions', 'POST')).status).toBe(413)
  })

  it('413s an oversized PATCH /forms/submissions/read', async () => {
    const { app } = makeApp()
    expect(
      (await oversize(app, '/forms/submissions/read', 'PATCH')).status
    ).toBe(413)
  })

  it('413s an oversized DELETE /forms/submissions', async () => {
    const { app } = makeApp()
    expect((await oversize(app, '/forms/submissions', 'DELETE')).status).toBe(
      413
    )
  })

  it('still accepts a normal-sized admin write', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submissions', {
      formId: 'contact',
      fields: { email: 'a@b.c' }
    })
    expect(res.status).toBe(201)
  })
})

// #932 — the boundary is a Zod schema now, not `asRecord`/`isStringArray`. Most of what the
// schemas must do is already pinned above (the caps block, the coercion tests, the 400 envelopes);
// this block covers the three things the hand-rolled narrowing got WRONG, each of which the schema
// fixes, plus the parity cases where a schema could easily have tightened something it shouldn't.
describe('createFormsApi — Zod at the forms boundary (#932)', () => {
  const raw = (
    app: ReturnType<typeof createFormsApi>,
    path: string,
    body: string,
    method = 'POST'
  ) =>
    app.fetch(
      new Request(`http://x${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body
      })
    )

  // KILL-SHOT TARGET 1. `asRecord(await c.req.json())` never guarded the PARSE: a body that is not
  // JSON at all rejected inside the handler, so apiOnError turned an anonymous caller's malformed
  // input into a 500 `internal_error` plus a correlation-id error log — the exact inversion of
  // docs/security-standards.md's "client-input 4xxs stay specific; only faults get masked".
  it('answers 400, not 500, when the public submit body is not JSON at all', async () => {
    const { app } = makeApp()
    for (const body of ['not json', '', '{"formId":', '[1,2']) {
      const res = await raw(app, '/forms/submit', body)
      expect(res.status, body).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: 'invalid' })
    }
  })

  it('answers 400, not 500, when an admin body is not JSON at all', async () => {
    const { app } = makeApp()
    const cases: [string, string][] = [
      ['/forms/submissions', 'POST'],
      ['/forms/submissions/read', 'PATCH'],
      ['/forms/submissions', 'DELETE']
    ]
    for (const [path, method] of cases) {
      const res = await raw(app, path, 'not json', method)
      expect(res.status, `${method} ${path}`).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid' })
    }
  })

  // KILL-SHOT TARGET 2. `typeof [] === 'object'`, so the old `asRecord` accepted an ARRAY as
  // `fields` and renamed its entries `{ '0': 'a', '1': 'b' }` — field names the visitor never
  // sent — then went on to spend a captcha verification on it. A record schema refuses it AT THE
  // BOUNDARY.
  //
  // The status alone proves nothing here: the submission service rejects `{0:'a',1:'b'}` for
  // having no email field, so `400` was already the answer for the WRONG reason (the #638 vacuous-
  // assertion class). What discriminates the boundary from the service is whether the captcha was
  // consulted — the boundary check runs before it, the service after.
  it('refuses an array as `fields` at the boundary, before the captcha is consulted', async () => {
    const verify = vi.fn(async () => true)
    const { app, submissions } = makeApp({ verify })
    const res = await post(app, '/forms/submit', {
      formId: 'contact',
      fields: ['a', 'b'],
      captchaToken: 'tok'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid' })
    expect(verify).not.toHaveBeenCalled()
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  // KILL-SHOT TARGET 3. The admin route cast `body['source']` straight to
  // `SubmissionInput['source']` with no validation at all, so it stored whatever shape arrived —
  // unknown keys and non-string values included, i.e. the stored row could contradict its own
  // type. The schema keeps the three declared string fields and drops the rest.
  it('sanitizes `source` on the admin write instead of casting it unchecked', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submissions', {
      formId: 'contact',
      fields: { email: 'a@b.c' },
      source: {
        url: 'https://x.test/a',
        referrer: 42,
        userAgent: 'UA/1',
        evil: { nested: true }
      }
    })
    expect(res.status).toBe(201)
    const saved = (await res.json()) as {
      source?: Record<string, unknown>
    }
    expect(saved.source).toEqual({
      url: 'https://x.test/a',
      userAgent: 'UA/1'
    })
  })

  // Parity guards — a schema is the easiest place to accidentally tighten something the route
  // deliberately tolerates. Each of these was true before #932 and must stay true.
  it('still keeps a non-string formLabel/honeypot/source out of the way rather than refusing', async () => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submit', {
      formId: 'contact',
      formLabel: 42,
      honeypot: { a: 1 },
      source: 'not-an-object',
      fields: { email: 'a@x.com', message: 'hi there' },
      captchaToken: 'tok'
    })
    expect(res.status).toBe(200)
    const stored = (await submissions.listSubmissions()).rows[0]!
    expect(stored.formLabel).toBeUndefined()
  })

  it('still stores a body-supplied source.url and drops an empty one', async () => {
    const { app, submissions } = makeApp()
    await post(app, '/forms/submit', {
      formId: 'contact',
      fields: { email: 'a@x.com', message: 'hi there' },
      source: { url: 'https://x.test/page' },
      captchaToken: 'tok'
    })
    await post(app, '/forms/submit', {
      formId: 'contact2',
      fields: { email: 'a@x.com', message: 'hi there' },
      source: { url: '' },
      captchaToken: 'tok'
    })
    const rows = (await submissions.listSubmissions()).rows
    const withUrl = rows.find((r) => r.formId === 'contact')!
    const withoutUrl = rows.find((r) => r.formId === 'contact2')!
    expect(withUrl.source?.url).toBe('https://x.test/page')
    expect(withoutUrl.source?.url).toBeUndefined()
  })

  it('still rejects a non-string entry in `ids` and a non-boolean `read`', async () => {
    const { app } = makeApp()
    expect(
      (
        await post(
          app,
          '/forms/submissions/read',
          { ids: ['a', 7], read: true },
          'PATCH'
        )
      ).status
    ).toBe(400)
    expect(
      (
        await post(
          app,
          '/forms/submissions/read',
          { ids: ['a'], read: 'yes' },
          'PATCH'
        )
      ).status
    ).toBe(400)
    expect(
      (await post(app, '/forms/submissions', { ids: ['a', null] }, 'DELETE'))
        .status
    ).toBe(400)
  })
})
