import { Resend } from 'resend'
import type { EmailPort, EmailMessage } from '@setu/core'

/**
 * Per-request options the adapter passes alongside the message.
 *
 * `signal` is NOT part of resend 6.18.0's declared request options — `PostOptions` (and therefore
 * `CreateEmailRequestOptions`) is `{ query?, headers? }` — but `Resend.post` builds its fetch
 * RequestInit as `{ method, body, ...options, headers }`, so a `signal` in here does reach `fetch`.
 * That is an implementation detail of the installed SDK, so it is treated as BEST EFFORT: it
 * cancels the socket when it works, and {@link createResendEmailAdapter}'s own deadline is what
 * actually bounds the call either way. packages/email-resend/test/request-timeout.test.ts covers
 * both halves separately — one case drives a client that ignores the option entirely, another
 * drives the real SDK against a blackhole listener and asserts the socket CLOSES.
 */
interface ResendSendOptions {
  signal?: AbortSignal
  /** Never set by this adapter. It is declared solely so this type has a property in COMMON with
   *  the SDK's `CreateEmailRequestOptions`: TypeScript's weak-type detection rejects an argument
   *  type whose properties are all unknown to the target, so a `{ signal?: AbortSignal }`-only
   *  shape fails to typecheck against `new Resend(...)` (verified — `pnpm --filter
   *  @setu/email-resend typecheck` reports "has no properties in common" without this line). */
  headers?: Record<string, string>
}

/** Minimal structural type matching what resend SDK v6 exposes for emails.send */
interface ResendLike {
  emails: {
    send(
      args: EmailMessage,
      options?: ResendSendOptions
    ): Promise<{
      data: unknown
      error: { message: string; name: string } | null
    }>
  }
}

/**
 * #930: the deadline on one Resend API call, mirroring #928's bound on the SMTP adapter.
 *
 * The adapter has to own this because the SDK offers nothing to own it with. Verified against the
 * INSTALLED source rather than from memory — resend 6.18.0, which is also npm's `latest` (checked
 * 2026-07-26, 166 published versions, MIT): `fetchRequest` in `dist/index.mjs` is a bare
 * `await fetch(`${this.baseUrl}${path}`, options)`, `ResendOptions` is `{ baseUrl, userAgent }`
 * with no timeout, and no request option declares one either. So an endpoint that accepts the
 * connection and then goes quiet holds the call for as long as the runtime's default `fetch`
 * allows — on the public, unauthenticated `POST /forms/submit` path, where the notification is
 * awaited in-request and the submission row is already persisted, so the wait buys nothing.
 *
 * 15 s is in the same seconds range as `SMTP_TIMEOUT_DEFAULTS` and generous for a single HTTPS
 * round trip to an API (Resend's own p99 is well under a second); an operator on a pathological
 * link raises it with `SETU_RESEND_TIMEOUT_MS`. Unlike the SMTP adapter this is ONE budget rather
 * than four phases, because there is one call and no protocol conversation to time separately.
 * Pinned by packages/email-resend/test/request-timeout.test.ts.
 */
export const RESEND_REQUEST_TIMEOUT_DEFAULT = 15_000

export interface ResendEmailAdapterOptions {
  apiKey: string
  /** #930: ms budget for one `emails.send` call. Falls back to
   *  {@link RESEND_REQUEST_TIMEOUT_DEFAULT}, never to "however long fetch waits". Parsed from
   *  SETU_RESEND_TIMEOUT_MS by apps/api/src/capabilities.ts and passed in by server.ts. */
  requestTimeoutMs?: number
  /** Test seam: injected client replaces the real SDK one. */
  client?: ResendLike
}

/** Resend-backed EmailPort. Works in Node + edge (the SDK is fetch-based, and `AbortController` /
 *  `setTimeout` are available on both). */
export function createResendEmailAdapter(
  opts: ResendEmailAdapterOptions
): EmailPort {
  const client: ResendLike = opts.client ?? new Resend(opts.apiKey)
  const timeoutMs = opts.requestTimeoutMs ?? RESEND_REQUEST_TIMEOUT_DEFAULT
  return {
    async send(msg: EmailMessage) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const timedOut = (): Error =>
        new Error(`resend request timed out after ${timeoutMs}ms`)
      // Rejects the moment the deadline fires, whether or not the SDK honoured the signal. This is
      // the arm that makes the bound real; the signal above is what additionally frees the socket.
      const deadline = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(timedOut()), {
          once: true
        })
      })
      try {
        // `Promise.race` attaches handlers to BOTH arms, so a send that rejects after the deadline
        // already won is still an attached rejection, not an unhandled one (verified by running the
        // shape under `process.on('unhandledRejection')`).
        const settled = await Promise.race([
          client.emails.send(msg, { signal: controller.signal }),
          deadline
        ])
        // The signal having fired takes precedence over whatever the SDK returned for it: on abort
        // it resolves with its own generic "Unable to fetch data" error object rather than
        // rejecting, and reporting that to the operator instead of the timeout would hide the one
        // fact that identifies the fault.
        if (controller.signal.aborted) throw timedOut()
        if (settled.error) throw new Error(settled.error.message)
      } finally {
        // Not a `catch`-less `try/finally` swallowing a failure (CLAUDE.md §3.2): every throw above
        // propagates to the caller. This only stops the pending timer from holding the event loop
        // open after a prompt send.
        clearTimeout(timer)
      }
    }
  }
}
