import { createTransport } from 'nodemailer'
import type { EmailPort, EmailMessage } from '@setu/core'

/** Minimal structural slice of nodemailer's Transporter — just the one call the
 *  adapter makes. Injected in tests so the contract suite runs without sockets
 *  (packages/email-smtp/test/contract.test.ts). */
export interface SmtpTransportLike {
  sendMail(msg: EmailMessage): Promise<unknown>
}

export interface SmtpEmailAdapterOptions {
  host: string
  port: number
  /** Implicit TLS from the first byte (SMTPS, conventionally port 465).
   *  Defaults to false: nodemailer then upgrades opportunistically via
   *  STARTTLS when the server offers it (the right default for :587
   *  submission and for local sinks like Mailpit). */
  secure?: boolean
  /** Optional — Mailpit and many internal relays accept unauthenticated
   *  submission. Never logged by this adapter. */
  auth?: { user: string; pass: string }
  /** Test seam: injected transport replaces the real nodemailer one. */
  transport?: SmtpTransportLike
}

/** SMTP-backed EmailPort (nodemailer). Node-topology only: SMTP needs raw TCP
 *  sockets, which Workers don't provide — this package must never be imported
 *  from edge-reachable code (it lives outside core's tsconfig.edge.json graph). */
export function createSmtpEmailAdapter(
  opts: SmtpEmailAdapterOptions
): EmailPort {
  const transport: SmtpTransportLike =
    opts.transport ??
    createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? false,
      auth: opts.auth
    })
  return {
    async send(msg: EmailMessage) {
      // EmailMessage fields (to/from/subject/html/text) map 1:1 onto
      // nodemailer's sendMail options; sendMail rejects on transport/server
      // failure, which is exactly the EmailPort contract's failure surface.
      await transport.sendMail(msg)
    }
  }
}
