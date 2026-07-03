import { Resend } from 'resend'
import type { EmailPort, EmailMessage } from '@setu/core'

/** Minimal structural type matching what resend SDK v6 exposes for emails.send */
interface ResendLike {
  emails: {
    send(
      args: EmailMessage
    ): Promise<{
      data: unknown
      error: { message: string; name: string } | null
    }>
  }
}

/** Resend-backed EmailPort. Works in Node + edge (the SDK is fetch-based). */
export function createResendEmailAdapter(opts: {
  apiKey: string
  client?: ResendLike
}): EmailPort {
  const client: ResendLike =
    opts.client ?? (new Resend(opts.apiKey))
  return {
    async send(msg: EmailMessage) {
      const { error } = await client.emails.send(msg)
      if (error) throw new Error(error.message)
    }
  }
}
