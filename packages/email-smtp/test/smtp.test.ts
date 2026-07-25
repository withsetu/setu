import { describe, it, expect, vi } from 'vitest'
import { createSmtpEmailAdapter } from '../src/index'

describe('smtp email adapter', () => {
  it('maps EmailMessage 1:1 onto transporter.sendMail', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'm1' }))
    const adapter = createSmtpEmailAdapter({
      host: 'smtp.example.com',
      port: 587,
      transport: { sendMail }
    })
    await adapter.send({
      to: 'a@x.com',
      from: 'site@x.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x'
    })
    expect(sendMail).toHaveBeenCalledWith({
      to: 'a@x.com',
      from: 'site@x.com',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'x'
    })
  })

  it('omits the text field entirely when the message has none', async () => {
    const sendMail = vi.fn(async (_msg: object) => ({ messageId: 'm2' }))
    const adapter = createSmtpEmailAdapter({
      host: 'smtp.example.com',
      port: 587,
      transport: { sendMail }
    })
    await adapter.send({
      to: 'a@x.com',
      from: 'site@x.com',
      subject: 'Hi',
      html: '<p>x</p>'
    })
    const arg = sendMail.mock.calls[0]![0]
    expect('text' in arg).toBe(false)
  })

  it('rejects when the transport rejects (failure is surfaced, not swallowed)', async () => {
    const adapter = createSmtpEmailAdapter({
      host: 'smtp.example.com',
      port: 587,
      transport: {
        async sendMail() {
          throw new Error('535 authentication failed')
        }
      }
    })
    await expect(
      adapter.send({ to: 'a@x.com', from: 's@x.com', subject: 'h', html: 'x' })
    ).rejects.toThrow('535 authentication failed')
  })
})
