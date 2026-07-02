import type { EmailPort, EmailMessage } from '@setu/core'

/** Zero-config dev adapter: logs the email instead of sending. */
export function createConsoleEmailAdapter(log: (line: string) => void = console.log): EmailPort {
  return {
    async send(msg: EmailMessage) {
      log(`[email-console] to=${msg.to} from=${msg.from} subject=${JSON.stringify(msg.subject)}\n${msg.text ?? msg.html}`)
    },
  }
}

// #273 cross-run cache-hit probe (harmless comment)
