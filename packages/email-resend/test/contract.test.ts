import { runEmailPortContract } from '@setu/email-testing'
import type { EmailMessage } from '@setu/core'
import { createResendEmailAdapter } from '../src/index'

/** Structural stand-in for the resend SDK's `emails.send`, injected so the
 *  contract runs hermetically (no network). */
type SendArgs = EmailMessage

runEmailPortContract(() => {
  const forwarded: SendArgs[] = []
  const okClient = {
    emails: {
      async send(args: SendArgs) {
        forwarded.push(args)
        return { data: { id: 'ok' }, error: null }
      }
    }
  }
  const errClient = {
    emails: {
      async send() {
        return {
          data: null,
          error: { message: 'transport rejected', name: 'send_failed' }
        }
      }
    }
  }
  return {
    adapter: createResendEmailAdapter({ apiKey: 'test', client: okClient }),
    outbound: () => forwarded.map((a) => JSON.stringify(a)),
    failing: createResendEmailAdapter({ apiKey: 'test', client: errClient })
  }
})
