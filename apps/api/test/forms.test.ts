import { describe, it, expect } from 'vitest'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import { createFormsApi } from '../src/forms'

function makeApp(verify = async () => true) {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({ submissions, captcha: { verify } })
  const app = createFormsApi({ submit, submissions })
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
    const { app } = makeApp(async () => false)
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
    const app = createFormsApi({ submit, submissions })
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
