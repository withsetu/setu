/** A single outbound email. `html` is required; `text` is an optional plaintext
 *  alternative. Provider-agnostic — adapters map this to their SDK/binding. */
export interface EmailMessage {
  to: string
  from: string
  subject: string
  html: string
  text?: string
}

/** Provider-agnostic email sender. Implementations: console (dev), resend,
 *  ses, smtp, cloudflare. */
export interface EmailPort {
  send(msg: EmailMessage): Promise<void>
}
