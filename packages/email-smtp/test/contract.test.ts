import { runEmailPortContract } from '@setu/email-testing'
import type { EmailMessage } from '@setu/core'
import { createSmtpEmailAdapter } from '../src/index'

/** Structural stand-in for nodemailer's `transporter.sendMail`, injected so the
 *  contract runs hermetically (no sockets) — same seam email-resend's contract
 *  test uses for the resend SDK client. */
runEmailPortContract(() => {
  const forwarded: EmailMessage[] = []
  const okTransport = {
    async sendMail(msg: EmailMessage) {
      forwarded.push(msg)
      return { messageId: 'ok' }
    }
  }
  const errTransport = {
    async sendMail(): Promise<unknown> {
      throw new Error('connect ECONNREFUSED')
    }
  }
  return {
    adapter: createSmtpEmailAdapter({
      host: '127.0.0.1',
      port: 1025,
      transport: okTransport
    }),
    outbound: () => forwarded.map((m) => JSON.stringify(m)),
    failing: createSmtpEmailAdapter({
      host: '127.0.0.1',
      port: 1025,
      transport: errTransport
    })
  }
})
