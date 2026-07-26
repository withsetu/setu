import type { EmailPort } from '@setu/core'
import type { UsableEmailTransport } from './capabilities'

export interface ResetEmailPreconditions {
  /** The resolved from-address, or undefined when none is configured. */
  from: string | undefined
  /** The admin SPA origin the reset link points at, or undefined outside local mode with
   *  SETU_ADMIN_ORIGIN unset. */
  adminOrigin: string | undefined
  /** The adapter that would ACTUALLY send — `usableEmailTransport(...).effective`, not the
   *  selection. A selection whose secret is missing degrades to 'console' here, which is the
   *  whole point: the selection can say "resend" while the sender is the console adapter. */
  effectiveTransport: UsableEmailTransport['effective']
}

/**
 * Whether password-reset emails may be wired at all (#894).
 *
 * Before this, the reset gate was `notifyFrom && adminOrigin` while transport selection keyed on
 * the transport being USABLE — two predicates over different inputs. With a from-address and an
 * admin origin set but no usable provider (the default, and any misconfigured resend/smtp), reset
 * was ENABLED and its transport was the console adapter, which logs the message body — i.e. the
 * reset URL, token in the path, into stdout.
 *
 * The third condition is `effectiveTransport !== 'console'`, deliberately NOT
 * `emailCapability.deliverable`: `deliverable` folds the from-address back in, and this predicate
 * already takes `from` explicitly from the caller's own live reading (server.ts's `liveFrom`),
 * so reusing it would mean two different readings of the same fact inside one condition. The
 * transport half is the only part `deliverable` adds, and it is exactly what is asked for here.
 *
 * This also puts the SERVER gate where the admin UI's already is: the forgot-password card keys
 * on /api/capabilities' `email.deliverable`, so a console-effective instance was already telling
 * users "password reset isn't configured for this site" while the API happily served the request
 * (CLAUDE.md §4 #13, the UI-only gate).
 *
 * Local topology is NOT exempt. Console is the intended transport there, but stdout is still a
 * file for anyone running the app as a background service, and the local topology has both the
 * loopback handshake and `apps/api/src/scripts/reset-password.ts` as owner-recovery paths that
 * need no email at all. Branches pinned by apps/api/test/reset-email-gate.test.ts.
 */
export function resetEmailEnabled(p: ResetEmailPreconditions): boolean {
  return resetEmailRefusal(p) === null
}

/**
 * Why a reset email would be refused for these preconditions, or `null` when it would be sent.
 *
 * The reason strings are the SAME ones `createResetEmailSender` reports, because that sender is
 * this function's only other caller (#912) — a route that wants to tell an admin why nothing was
 * sent therefore cannot drift from what the sender actually does. They are operator prose in the
 * boot-log register: no credential values, no paths. Branches pinned by
 * apps/api/test/reset-email-gate.test.ts.
 */
export function resetEmailRefusal(p: ResetEmailPreconditions): string | null {
  if (p.effectiveTransport === 'console')
    return (
      'the effective email transport is the console adapter, which writes messages to this ' +
      'server log instead of delivering them — a reset link must never be logged'
    )
  if (!p.from || !p.adminOrigin)
    return 'no from-address or admin origin is configured'
  return null
}

/**
 * The reset-email sender: re-checks `resetEmailEnabled` against the LIVE transport and
 * from-address on every send, and refuses rather than hand a credential-bearing message to a
 * transport that cannot deliver it.
 *
 * The boot gate alone is not enough. Since #890 the provider is re-resolved per send from
 * settings.json, which is Git-canonical — so an instance that booted with a usable provider can
 * be switched to console by a `git push` that never passes the settings-write gate, and the
 * boot-time `email:` option would keep sending into it.
 *
 * Refusing means resolving without sending, not throwing: better-auth's request-password-reset
 * answers a uniform `{ status: true }` whether or not the account exists (and swallows
 * sendResetPassword errors anyway), so a throw would change nothing the caller can see while
 * losing our named reason. `onRefused` is what makes the failure reported rather than silent
 * (CLAUDE.md §3.2) — server.ts points it at a console.error AND the onAuthEvent audit seam.
 *
 * #912: `onRefused` is not the whole story for an AUTHENTICATED caller. Because the refusal
 * happens inside better-auth's send hook, it cannot travel back out through
 * `auth.api.requestPasswordReset`, so `POST /api/users/send-reset` used to answer
 * `{ status: true }` over a refusal and tell an admin an email had been sent. That route now
 * evaluates `resetEmailRefusal` itself, on the SAME live resolvers, immediately before asking for
 * the send — see its own comment in users.ts for what that does and does not guarantee. Pinned by
 * apps/api/test/reset-email-gate.test.ts and apps/api/test/users-send-reset.test.ts.
 */
export function createResetEmailSender(opts: {
  /** The live transport + from-address, resolved TOGETHER and called ONCE per send (#939 —
   *  server.ts's `createLiveEmailConfig`, one settings.json parse). The transport is the whole
   *  reading, not just `effective`, because it is handed straight to `sendVia` below. */
  resolveConfig: () => {
    transport: UsableEmailTransport
    /** Live from-address; wins over the message's boot-time `from` when present (#498). */
    from: string | undefined
  }
  /** Dispatch through a reading already in hand (server.ts's `email.sendVia`). */
  sendVia: (
    transport: UsableEmailTransport,
    msg: Parameters<EmailPort['send']>[0]
  ) => Promise<void>
  adminOrigin: string | undefined
  onRefused: (reason: string) => void
}): EmailPort['send'] {
  return async (msg) => {
    // #919: ONE reading per send of BOTH inputs, and what satisfied the gate is what dispatches —
    // the transport as the very object handed to `sendVia`, the from-address bound by value into
    // the message below. Previously this resolved the transport for the gate and then called an
    // `email.send` that resolved independently — two readings of a Git-canonical file, so a
    // `git pull`/checkout landing between them admitted the message on 'smtp' and delivered it on
    // 'console', i.e. wrote a live reset token into the server log.
    // #939 made "one reading" structural rather than a discipline: the transport and the
    // from-address arrive from a single `resolveConfig()` call, so there is no second read left
    // here to drift from — and the send costs one settings parse instead of two.
    // Enforced by apps/api/test/reset-email-gate.test.ts ("delivers through the EXACT reading it
    // gated on — transport AND from-address — resolving each once"), whose stub answers
    // DIFFERENTLY on a second call so one reading is distinguishable from two; a constant stub
    // could not tell them apart, which is how the from-address half of this claim sat unenforced
    // while the comment asserted it. End-to-end: apps/api/test/reset-password-leak.test.ts.
    const { transport, from: liveFrom } = opts.resolveConfig()
    const from = liveFrom ?? msg.from
    const refusal = resetEmailRefusal({
      from,
      adminOrigin: opts.adminOrigin,
      effectiveTransport: transport.effective
    })
    if (refusal !== null) {
      opts.onRefused(refusal)
      return
    }
    await opts.sendVia(transport, { ...msg, from })
  }
}
