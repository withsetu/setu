import type { EmailPort, EmailMessage } from '@setu/core'
import { redactSecretsInUrls } from './redact'

export { redactSecretsInUrls } from './redact'

/** Zero-config dev adapter: logs the email instead of sending.
 *
 *  It is also the fallback whenever a selected transport is unusable (apps/api's
 *  usableEmailTransport), so it can receive messages in a DEPLOYED instance — which is why the
 *  logged line is passed through `redactSecretsInUrls` first (#894). A reset link carries its
 *  token in the URL path; printing it verbatim put a working credential into stdout. Redaction
 *  is by shape, so it does not depend on the sender marking anything as sensitive. Enforced by
 *  packages/email-console/test/redact.test.ts and apps/api/test/reset-password-leak.test.ts. */
export function createConsoleEmailAdapter(
  log: (line: string) => void = console.log
): EmailPort {
  return {
    async send(msg: EmailMessage) {
      log(
        redactSecretsInUrls(
          `[email-console] to=${msg.to} from=${msg.from} subject=${JSON.stringify(msg.subject)}\n${msg.text ?? msg.html}`
        )
      )
    }
  }
}

// #273 cross-run cache-hit probe (harmless comment)
