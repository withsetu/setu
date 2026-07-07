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
    expect(send).toHaveBeenCalledWith({
      to: 'a@x.com',
      from: 'site@x.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x'
    })
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
