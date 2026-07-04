import { describe, it, expect } from 'vitest'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import type { Actor, Role } from '@setu/core'
import { createFormsApi } from '../src/forms'
import type { ResolveActor } from '../src/auth/resolve-actor'

// Default resolver acts as an admin so the pre-existing behavioural tests still exercise the CRUD
// as an authorized caller. The gating tests below pass their own role-specific / null resolvers.
const asRole = (role: Role): ResolveActor => () => ({ id: 'u', role } satisfies Actor)
const unauthenticated: ResolveActor = () => null

function makeApp(opts?: { verify?: () => Promise<boolean>; resolveActor?: ResolveActor }) {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({ submissions, captcha: { verify: opts?.verify ?? (async () => true) } })
  const app = createFormsApi({ submit, submissions, resolveActor: opts?.resolveActor ?? asRole('admin') })
  return { app, submissions }
}

const post = (app: ReturnType<typeof createFormsApi>, path: string, body: unknown, method = 'POST') =>
  app.fetch(new Request(`http://x${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

describe('createFormsApi', () => {
  it('POST /forms/submit stores a valid submission', async () => {
    const { app, submissions } = makeApp()
    const res = await post(app, '/forms/submit', {
      formId: 'contact',
      fields: { email: 'a@x.com', message: 'hi there' },
      captchaToken: 'tok',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('POST /forms/submit returns 403 on captcha failure', async () => {
    const { app } = makeApp({ verify: async () => false })
    const res = await post(app, '/forms/submit', { formId: 'c', fields: { email: 'a@x.com', message: 'x' }, captchaToken: 't' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: 'spam' })
  })

  it('POST /forms/submit returns 400 on invalid', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submit', { formId: 'c', fields: { email: 'bad', message: '' }, captchaToken: 't' })
    expect(res.status).toBe(400)
  })

  it('GET /forms/submissions lists with filters; GET /forms/forms summarizes', async () => {
    const { app, submissions } = makeApp()
    await submissions.saveSubmission({ formId: 'contact', formLabel: 'Contact', fields: { email: 'a@x.com', message: 'one' } })
    await submissions.saveSubmission({ formId: 'apply', formLabel: 'Apply', fields: { email: 'b@x.com', message: 'two' } })
    const list = (await (await app.fetch(new Request('http://x/forms/submissions?formId=contact'))).json()) as { total: number }
    expect(list.total).toBe(1)
    const forms = (await (await app.fetch(new Request('http://x/forms/forms'))).json()) as { forms: unknown[] }
    expect(forms.forms).toEqual([
      { formId: 'apply', formLabel: 'Apply', count: 1 },
      { formId: 'contact', formLabel: 'Contact', count: 1 },
    ])
  })

  it('GET /forms/captcha-status returns provider + secretConfigured booleans', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({ submissions, captcha: { verify: async () => true } })
    const app = createFormsApi({ submit, submissions, resolveActor: asRole('admin'), captchaStatus: { provider: 'turnstile', secretConfigured: true } })
    const res = await app.fetch(new Request('http://x/forms/captcha-status'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ provider: 'turnstile', secretConfigured: true })
  })

  it('GET /forms/captcha-status defaults to none when no status is supplied', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({ submissions, captcha: { verify: async () => true } })
    const app = createFormsApi({ submit, submissions, resolveActor: asRole('admin') })
    expect(await (await app.fetch(new Request('http://x/forms/captcha-status'))).json()).toEqual({
      provider: '',
      secretConfigured: false,
    })
  })

  it('PATCH read and DELETE work', async () => {
    const { app, submissions } = makeApp()
    const s = await submissions.saveSubmission({ formId: 'c', fields: { email: 'a@x.com', message: 'x' } })
    expect((await post(app, '/forms/submissions/read', { ids: [s.id], read: true }, 'PATCH')).status).toBe(200)
    expect((await submissions.getSubmission(s.id))!.read).toBe(true)
    expect((await post(app, '/forms/submissions', { ids: [s.id] }, 'DELETE')).status).toBe(200)
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
    ['/forms/forms', { method: 'GET' }],
  ]
  const WRITE_ROUTES: Array<[string, RequestInit]> = [
    ['/forms/submissions', { method: 'POST', body: JSON.stringify({ formId: 'c', fields: {} }) }],
    ['/forms/submissions/read', { method: 'PATCH', body: JSON.stringify({ ids: ['x'], read: true }) }],
    ['/forms/submissions', { method: 'DELETE', body: JSON.stringify({ ids: ['x'] }) }],
  ]
  const call = (app: ReturnType<typeof createFormsApi>, path: string, init: RequestInit) =>
    app.fetch(new Request(`http://x${path}`, { ...init, headers: { 'content-type': 'application/json' } }))

  it('rejects an UNAUTHENTICATED caller with 401 on every admin CRUD route', async () => {
    const { app } = makeApp({ resolveActor: unauthenticated })
    for (const [path, init] of [...READ_ROUTES, ...WRITE_ROUTES]) {
      expect((await call(app, path, init)).status, `${init.method} ${path}`).toBe(401)
    }
  })

  it('rejects a VIEWER (no forms.* capability) with 403 on every admin CRUD route', async () => {
    const { app } = makeApp({ resolveActor: asRole('viewer') })
    for (const [path, init] of [...READ_ROUTES, ...WRITE_ROUTES]) {
      expect((await call(app, path, init)).status, `${init.method} ${path}`).toBe(403)
    }
  })

  it('rejects an EDITOR (content role, no forms.*) with 403 — form PII is Maintainer+ only', async () => {
    const { app } = makeApp({ resolveActor: asRole('editor') })
    for (const [path, init] of [...READ_ROUTES, ...WRITE_ROUTES]) {
      expect((await call(app, path, init)).status, `${init.method} ${path}`).toBe(403)
    }
  })

  it('allows a MAINTAINER to read and manage submissions', async () => {
    const { app, submissions } = makeApp({ resolveActor: asRole('maintainer') })
    const s = await submissions.saveSubmission({ formId: 'c', fields: { email: 'a@x.com', message: 'x' } })
    expect((await call(app, '/forms/submissions', { method: 'GET' })).status).toBe(200)
    expect((await call(app, `/forms/submissions/${s.id}`, { method: 'GET' })).status).toBe(200)
    expect((await call(app, '/forms/submissions/read', { method: 'PATCH', body: JSON.stringify({ ids: [s.id], read: true }) })).status).toBe(200)
    expect((await call(app, '/forms/submissions', { method: 'DELETE', body: JSON.stringify({ ids: [s.id] }) })).status).toBe(200)
  })

  it('keeps the public embed routes open (no session needed)', async () => {
    const { app } = makeApp({ resolveActor: unauthenticated })
    expect((await call(app, '/forms/captcha-status', { method: 'GET' })).status).toBe(200)
    const submit = await call(app, '/forms/submit', {
      method: 'POST',
      body: JSON.stringify({ formId: 'contact', fields: { email: 'a@x.com', message: 'hello there' }, captchaToken: 't' }),
    })
    expect(submit.status).toBe(200)
  })
})
