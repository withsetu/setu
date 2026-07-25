import { describe, it, expect, vi } from 'vitest'
import { createSubmissionService } from '../../src/submissions/submission-service'
import { createMemorySubmissionPort } from '@setu/db-memory'
import type { EmailPort } from '../../src/email/email-port'

const ok = { verify: async () => true }
const base = {
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hello there' },
  captchaToken: 'tok'
}

describe('createSubmissionService.submit', () => {
  it('happy path: persists and returns ok with id', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, captcha: ok })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })

  it('honeypot filled: silently drops (ok, nothing stored)', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, captcha: ok })
    const r = await svc.submit({ ...base, honeypot: 'i am a bot' })
    expect(r).toEqual({ ok: true })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('captcha fails: returns spam, nothing stored', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({
      submissions,
      captcha: { verify: async () => false }
    })
    expect(await svc.submit({ ...base })).toEqual({ ok: false, error: 'spam' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('invalid email: returns invalid, nothing stored', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, captcha: ok })
    expect(
      await svc.submit({ ...base, fields: { email: 'nope', message: 'x' } })
    ).toEqual({ ok: false, error: 'invalid' })
    expect((await submissions.listSubmissions()).total).toBe(0)
  })

  it('rejects an adversarial email fast, without ReDoS backtracking (#340)', async () => {
    // /forms/submit is UNAUTHENTICATED — the old EMAIL_RE was quadratic here.
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, captcha: ok })
    const evil = 'a@' + '.'.repeat(100_000) + '@'
    const t = performance.now()
    expect(
      await svc.submit({ ...base, fields: { email: evil, message: 'x' } })
    ).toEqual({ ok: false, error: 'invalid' })
    expect(performance.now() - t).toBeLessThan(1000)
  })

  it('missing message: returns invalid', async () => {
    const submissions = createMemorySubmissionPort()
    const svc = createSubmissionService({ submissions, captcha: ok })
    expect(
      await svc.submit({ ...base, fields: { email: 'a@x.com', message: '  ' } })
    ).toEqual({ ok: false, error: 'invalid' })
  })

  it('notifies on success (best-effort) and survives email failure', async () => {
    const submissions = createMemorySubmissionPort()
    const send = vi.fn(async () => {
      throw new Error('provider down')
    })
    const email: EmailPort = { send }
    const svc = createSubmissionService({
      submissions,
      captcha: ok,
      email,
      notifyTo: 'owner@x.com',
      notifyFrom: 'site@x.com'
    })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) }) // not failed by email error
    expect(send).toHaveBeenCalledTimes(1)
    expect((await submissions.listSubmissions()).total).toBe(1) // stored regardless
  })

  // #498 (#885 review Finding 1): notifyFrom may be a thunk, resolved PER SUBMISSION — both the
  // notify gate and the sender follow the live value, so a from-address saved in Settings → Email
  // applies to the next form notification without an api restart.
  it('notifyFrom as a thunk: gate and sender are live — a from-address appearing after construction enables notify with the new sender', async () => {
    const submissions = createMemorySubmissionPort()
    const sent: { from: string }[] = []
    const email: EmailPort = {
      send: async (m) => {
        sent.push({ from: m.from })
      }
    }
    const live: { from: string | undefined } = { from: undefined }
    const svc = createSubmissionService({
      submissions,
      captcha: ok,
      email,
      notifyTo: 'owner@x.com',
      notifyFrom: () => live.from
    })

    await svc.submit({ ...base })
    expect(sent).toHaveLength(0) // no from-address anywhere yet → gate closed

    live.from = 'newsroom@x.com' // the admin saved a from-address; no reconstruction
    await svc.submit({ ...base })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.from).toBe('newsroom@x.com')
  })

  // #921 (CLAUDE.md §4 #22, silent-async): since #498 the from-address is resolved LIVE per
  // submission, so clearing `email.fromAddress` in Settings → Email — or a `git push` that clears
  // it, settings.json being Git-canonical — turns every form notification off instantly. The
  // block used to be skipped with no log, no counter and no signal, and the visitor still saw
  // `{ ok: true }`. The boot warning in apps/api/src/server.ts fires once and cannot cover this.
  describe('onNotifySkipped (#921)', () => {
    it('reports a named reason when notifications are configured but the from-address is gone', async () => {
      const submissions = createMemorySubmissionPort()
      const send = vi.fn(async () => {})
      const onNotifySkipped = vi.fn()
      const svc = createSubmissionService({
        submissions,
        captcha: ok,
        email: { send },
        notifyTo: 'owner@x.com',
        notifyFrom: () => undefined,
        onNotifySkipped
      })

      const r = await svc.submit({ ...base })

      expect(r).toEqual({ ok: true, id: expect.any(String) })
      expect(send).not.toHaveBeenCalled()
      expect(onNotifySkipped).toHaveBeenCalledTimes(1)
      const reason = String(onNotifySkipped.mock.calls[0]![0])
      expect(reason).toContain('from-address')
      // Operator prose, not a leak: the recipient address is a configured value, not something
      // to echo into a log line that may be shipped.
      expect(reason).not.toContain('owner@x.com')
    })

    // The inverse defect (#834 declined exactly this): reporting a failure that did not happen.
    // An instance that never configured notifications is not broken, and must stay quiet.
    it('stays quiet when notifications were never configured', async () => {
      const submissions = createMemorySubmissionPort()
      const onNotifySkipped = vi.fn()
      const svc = createSubmissionService({
        submissions,
        captcha: ok,
        email: { send: vi.fn(async () => {}) },
        notifyFrom: () => undefined,
        onNotifySkipped
      })

      await svc.submit({ ...base })

      expect(onNotifySkipped).not.toHaveBeenCalled()
    })

    // The notify block is best-effort by contract: the row is already persisted when it runs, so
    // NOTHING in it may turn a saved submission into a 500 at apps/api/src/forms.ts's handler
    // (which awaits submit() in-request). The send and the renderer were already wrapped; the
    // reporting callback and the live `notifyFrom` thunk — which reads settings.json in apps/api,
    // so it really can throw — were not.
    it('a throwing onNotifySkipped cannot fail a persisted submission', async () => {
      const submissions = createMemorySubmissionPort()
      const svc = createSubmissionService({
        submissions,
        captcha: ok,
        email: { send: vi.fn(async () => {}) },
        notifyTo: 'owner@x.com',
        notifyFrom: () => undefined,
        onNotifySkipped: () => {
          throw new Error('logger exploded')
        }
      })

      const r = await svc.submit({ ...base })

      expect(r).toEqual({ ok: true, id: expect.any(String) })
      expect((await submissions.listSubmissions()).total).toBe(1)
    })

    it('a throwing notifyFrom thunk cannot fail a persisted submission', async () => {
      const submissions = createMemorySubmissionPort()
      const svc = createSubmissionService({
        submissions,
        captcha: ok,
        email: { send: vi.fn(async () => {}) },
        notifyTo: 'owner@x.com',
        notifyFrom: () => {
          throw new Error('settings.json is unreadable')
        }
      })

      const r = await svc.submit({ ...base })

      expect(r).toEqual({ ok: true, id: expect.any(String) })
      expect((await submissions.listSubmissions()).total).toBe(1)
    })

    it('stays quiet on the happy path, and when there is no email port at all', async () => {
      const submissions = createMemorySubmissionPort()
      const onNotifySkipped = vi.fn()

      await createSubmissionService({
        submissions,
        captcha: ok,
        email: { send: vi.fn(async () => {}) },
        notifyTo: 'owner@x.com',
        notifyFrom: 'site@x.com',
        onNotifySkipped
      }).submit({ ...base })
      expect(onNotifySkipped).not.toHaveBeenCalled()

      // No transport wired (an edge topology without email) — the from-address is not the
      // reason anything is off here, so naming it would be a lie.
      await createSubmissionService({
        submissions,
        captcha: ok,
        notifyTo: 'owner@x.com',
        notifyFrom: () => undefined,
        onNotifySkipped
      }).submit({ ...base })
      expect(onNotifySkipped).not.toHaveBeenCalled()
    })
  })

  it('survives an async renderNotification that throws (best-effort)', async () => {
    const submissions = createMemorySubmissionPort()
    const email: EmailPort = { send: vi.fn(async () => {}) }
    const svc = createSubmissionService({
      submissions,
      captcha: ok,
      email,
      notifyTo: 'owner@x.com',
      notifyFrom: 'site@x.com',
      renderNotification: async () => {
        throw new Error('render boom')
      }
    })
    const r = await svc.submit({ ...base })
    expect(r).toEqual({ ok: true, id: expect.any(String) })
    expect((await submissions.listSubmissions()).total).toBe(1)
  })
})
