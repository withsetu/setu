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
  /** #928: bounded socket timeouts, all in ms, all optional — each falls back to the
   *  SMTP_TIMEOUT_DEFAULTS below, never to nodemailer's own. Parsed from SETU_SMTP_*_TIMEOUT_MS
   *  by apps/api/src/capabilities.ts's smtpConfigFromEnv and spread in here by server.ts. */
  connectionTimeout?: number
  greetingTimeout?: number
  socketTimeout?: number
  dnsTimeout?: number
  /** Test seam: injected transport replaces the real nodemailer one. */
  transport?: SmtpTransportLike
}

/** #928: explicit, SECONDS-scale timeouts, because nodemailer's defaults are MINUTES-scale and
 *  this adapter's send is awaited inside the request handler of the public, unauthenticated
 *  `POST /forms/submit` (apps/api/src/forms.ts → core's submission service, step 5). An SMTP host
 *  that accepts the TCP connection and then goes quiet therefore holds an api request and a socket
 *  for as long as the transport lets it, and the submission row is already persisted by then, so
 *  the wait buys nothing at all.
 *
 *  Verified against the INSTALLED source rather than from memory — nodemailer 9.0.3,
 *  `lib/smtp-connection/index.js:14-17`: CONNECTION_TIMEOUT 2 min, SOCKET_TIMEOUT 10 min,
 *  GREETING_TIMEOUT 30 s, DNS_TIMEOUT 30 s. Worst case there is over 13 minutes of held request;
 *  the values below bound it to well under one, while staying generous for a slow relay
 *  (a TLS handshake plus greeting on a congested link is single-digit seconds, and `socketTimeout`
 *  is an INACTIVITY timer, not a total-send budget, so a large attachment does not race it).
 *  An operator on a genuinely slow relay raises them via the SETU_SMTP_*_TIMEOUT_MS env vars.
 *  Pinned by packages/email-smtp/test/create-transport.test.ts. */
export const SMTP_TIMEOUT_DEFAULTS = {
  /** TCP connect. */
  connectionTimeout: 10_000,
  /** Time for the server's 220 banner once connected. */
  greetingTimeout: 10_000,
  /** Socket INACTIVITY once the conversation is under way. */
  socketTimeout: 20_000,
  /** Hostname resolution. */
  dnsTimeout: 5_000
} as const

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
      auth: opts.auth,
      // #928 — never omit one of these: an absent option means nodemailer's minutes-scale
      // default, which is the bug. `??` per field so a partial env override keeps the bounded
      // defaults for the rest.
      connectionTimeout:
        opts.connectionTimeout ?? SMTP_TIMEOUT_DEFAULTS.connectionTimeout,
      greetingTimeout:
        opts.greetingTimeout ?? SMTP_TIMEOUT_DEFAULTS.greetingTimeout,
      socketTimeout: opts.socketTimeout ?? SMTP_TIMEOUT_DEFAULTS.socketTimeout,
      dnsTimeout: opts.dnsTimeout ?? SMTP_TIMEOUT_DEFAULTS.dnsTimeout
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
