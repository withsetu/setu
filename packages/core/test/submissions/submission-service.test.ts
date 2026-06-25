import { describe, it, expect, vi } from 'vitest'
import { createSubmissionService } from '../../src/submissions/submission-service'
import { createMemorySubmissionPort } from '@setu/db-memory'
import type { EmailPort } from '../../src/email/email-port'

const ok = async () => true
const base = {
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hello there' },
  turnstileToken: 'tok',
}

describe('createSubmissionService.submit', () => {
  it('happy path: persists and returns ok with id', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('honeypot filled: silently drops (ok, nothing stored)', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    const r = await svc.submit({ ...base, honeypot: 'i am a bot' })
    expect(r).toEqual({ ok: true })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('turnstile fails: returns spam, nothing stored', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: async () => false })
    expect(await svc.submit({ ...base })).toEqual({ ok: false, error: 'spam' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('invalid email: returns invalid, nothing stored', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    expect(await svc.submit({ ...base, fields: { email: 'nope', message: 'x' } })).toEqual({ ok: false, error: 'invalid' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('missing message: returns invalid', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, verifyTurnstile: ok })
    expect(await svc.submit({ ...base, fields: { email: 'a@x.com', message: '  ' } })).toEqual({ ok: false, error: 'invalid' })
  })

  it('notifies on success (best-effort) and survives email failure', async () => {
    const submissions = createMemorySubmissionPort()
    const send = vi.fn(async () => {
      throw new Error('provider down')
    })
    const email: EmailPort = { send }
    const svc = createSubmissionService({
      submissions,
      verifyTurnstile: ok,
      email,
      notifyTo: 'owner@x.com',
      notifyFrom: 'site@x.com',
    })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) }) // not failed by email error
    expect(send).toHaveBeenCalledTimes(1)
    expect((await submissions.listSubmissions()).total).toBe(1) // stored regardless
  })

  it('survives an async renderNotification that throws (best-effort)', async () => {
    const submissions = createMemorySubmissionPort()
    const email: EmailPort = { send: vi.fn(async () => {}) }
    const svc = createSubmissionService({
      submissions,
      verifyTurnstile: ok,
      email,
      notifyTo: 'owner@x.com',
      notifyFrom: 'site@x.com',
      renderNotification: async () => {
        throw new Error('render boom')
      },
    })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })
})
