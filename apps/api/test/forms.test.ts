import { describe, it, expect } from 'vitest'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import type { Actor, Role } from '@setu/core'
import { createFormsApi } from '../src/forms'
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
