import { describe, it, expect } from 'vitest'
import { createMemorySubmissionPort } from '@setu/db-memory'
import { createSubmissionService } from '@setu/core'
import { createFormsApi } from '../src/forms'

function makeApp(verify = async () => true) {
  const submissions = createMemorySubmissionPort()
  const submit = createSubmissionService({ submissions, verifyTurnstile: verify })
  const app = createFormsApi({ submit, submissions })
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
      turnstileToken: 'tok',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('POST /forms/submit returns 403 on turnstile failure', async () => {
    const { app } = makeApp(async () => false)
    const res = await post(app, '/forms/submit', { formId: 'c', fields: { email: 'a@x.com', message: 'x' }, turnstileToken: 't' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: 'spam' })
  })

  it('POST /forms/submit returns 400 on invalid', async () => {
    const { app } = makeApp()
    const res = await post(app, '/forms/submit', { formId: 'c', fields: { email: 'bad', message: '' }, turnstileToken: 't' })
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

  it('PATCH read and DELETE work', async () => {
    const { app, submissions } = makeApp()
    const s = await submissions.saveSubmission({ formId: 'c', fields: { email: 'a@x.com', message: 'x' } })
    expect((await post(app, '/forms/submissions/read', { ids: [s.id], read: true }, 'PATCH')).status).toBe(200)
    expect((await submissions.getSubmission(s.id))!.read).toBe(true)
    expect((await post(app, '/forms/submissions', { ids: [s.id] }, 'DELETE')).status).toBe(200)
    expect(await submissions.getSubmission(s.id)).toBeNull()
  })
})
