import { describe, it, expect, vi } from 'vitest'
import { createResendEmailAdapter } from '../src/index'

describe('resend email adapter', () => {
  it('maps EmailMessage to resend.emails.send', async () => {
    const send = vi.fn(async () => ({ data: { id: 'r1' }, error: null }))
    const adapter = createResendEmailAdapter({
      apiKey: 'k',
      client: { emails: { send } }
    })
    await adapter.send({
      to: 'a@x.com',
      from: 'site@x.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x'
    })
    // #930 added a second argument carrying the request's AbortSignal, so this asserts the message
    // positionally rather than pinning the whole call. That the signal is really there — and really
    // cancels the socket — is packages/email-resend/test/request-timeout.test.ts's job.
    expect(send.mock.calls[0]?.[0]).toEqual({
      to: 'a@x.com',
      from: 'site@x.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x'
    })
    expect(send.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws when resend returns an error shape', async () => {
    const send = vi.fn(async () => ({
      data: null,
      error: { message: 'bad key', name: 'invalid_api_key' }
    }))
    const adapter = createResendEmailAdapter({
      apiKey: 'k',
      client: { emails: { send } }
    })
    await expect(
      adapter.send({ to: 'a@x.com', from: 's@x.com', subject: 'h', html: 'x' })
    ).rejects.toThrow('bad key')
  })
})
