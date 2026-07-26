import type { EmailPort } from '@setu/core'
import type { ResetEmailRequest } from '@setu/auth'
import type { UsableEmailTransport } from './capabilities'
import type { EmailConfig } from './email-config'

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
 * already takes `from` explicitly from the caller's own live reading (`createResetEmailGate`'s
 * `resolveConfig`, i.e. server.ts's `liveEmailConfig().from` — one settings parse, #939), so
 * reusing it would mean two different readings of the same fact inside one condition. The
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
 * Why a reset email cannot be sent: a stable machine `code` plus operator prose.
 *
 * The code exists because ONE 409 used to carry two different reasons (#944). apps/api/src/users.ts
 * answered every refusal with `email_not_deliverable` and the Users screen rendered that as "Pick a
 * provider in Settings → Email" — the wrong thing to fix when what is missing is the from-address.
 * The `reason` stays server-side (boot log, `onRefused`, the onAuthEvent audit seam); only the code
 * crosses the wire, because a self-target reset is reachable by a non-admin. Codes and their
 * mapping are pinned by apps/api/test/reset-email-gate.test.ts and
 * apps/api/test/users-send-reset.test.ts; the admin-facing remediation for each by
 * apps/admin/test/users-screen.test.tsx.
 */
export interface ResetEmailRefusal {
  code:
    | 'email_transport_not_deliverable'
    | 'email_from_address_missing'
    | 'reset_link_origin_missing'
  /** Operator prose in the boot-log register: no credential values, no paths. */
  reason: string
}

/**
 * Why a reset email would be refused for these preconditions, or `null` when it would be sent.
 *
 * Every caller — the boot gate (`resetEmailEnabled`), the sender and the admin route — asks THIS
 * function, so "reset is off", "nothing was sent" and the reason an admin is shown are one
 * judgement rather than three. The two live callers reach it through `createResetEmailGate` below,
 * which is what makes them share the from-address fallback too (#944). Branches pinned by
 * apps/api/test/reset-email-gate.test.ts.
 */
export function resetEmailRefusal(
  p: ResetEmailPreconditions
): ResetEmailRefusal | null {
  if (p.effectiveTransport === 'console')
    return {
      code: 'email_transport_not_deliverable',
      reason:
        'the effective email transport is the console adapter, which writes messages to this ' +
        'server log instead of delivering them — a reset link must never be logged'
    }
  // Split from the admin-origin branch below in #944: they are two different settings to fix, and
  // collapsing them meant the admin was pointed at whichever one the message happened to name.
  if (!p.from)
    return {
      code: 'email_from_address_missing',
      reason: 'no from-address is configured to send the reset email from'
    }
  if (!p.adminOrigin)
    return {
      code: 'reset_link_origin_missing',
      reason: 'no admin origin is configured to point the reset link at'
    }
  return null
}

/** The two live reset-email entry points, built together so they answer from one reading rule. */
export interface ResetEmailGate {
  /** @setu/auth's `email.sendReset` hook (server.ts's `email:` option). Since #958 it owns the
   *  BODY as well as the dispatch, which is what lets one reset cost one settings read. */
  sendReset: (request: ResetEmailRequest) => Promise<void>
  /** Why the NEXT send would be refused, or `null` when it would go out — what
   *  `POST /api/users/send-reset` reports instead of claiming a send it cannot see the result of
   *  (#912). It re-reads live state per call, exactly as `sendReset` does. */
  refusal: () => ResetEmailRefusal | null
}

/**
 * The reset-email gate: re-checks `resetEmailEnabled` against the LIVE transport and
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
 * `{ status: true }` over a refusal and tell an admin an email had been sent. `refusal()` is what
 * that route asks instead — see its own comment in users.ts for what that does and does not
 * guarantee.
 *
 * #944: `sendReset` and `refusal` are returned TOGETHER because they used to be assembled
 * separately and fell back differently — the sender to better-auth's boot-time `msg.from`, the
 * route to nothing — so clearing `email.fromAddress` after boot made the admin route answer 409
 * "no email sent" while the public flow, through this very sender, still sent. Both now read
 * through the one `decide()` below, so the fallback cannot be applied on one path and not the
 * other, and `sendReset` can only obtain a from-address out of a null refusal. Pinned by
 * apps/api/test/reset-email-gate.test.ts ("the route and the sender must agree on the
 * from-address") and apps/api/test/users-send-reset.test.ts.
 */
export function createResetEmailGate(opts: {
  /** The whole live reading, resolved TOGETHER and called ONCE per send (#939 — server.ts's
   *  `createLiveEmailConfig`, one settings.json parse). The transport is the whole reading, not
   *  just `effective`, because it is handed straight to `sendVia` below.
   *  #958: it is the WHOLE `EmailConfig` — not the `{ transport, from }` pair it used to be —
   *  because the body is rendered from this same reading now, which is what makes one reset cost
   *  one parse (apps/api/test/email-read-count.test.ts, 'parses settings.json exactly ONCE, and a
   *  save applies to the next reset'). */
  resolveConfig: () => EmailConfig
  /** The body, rendered from the reading the gate just judged — server.ts passes
   *  `emailTemplates.renderWith(config, …)`, the admin's stored override applied with no second
   *  read. Omitted → @setu/auth's shipped default (`request.defaultContent()`), which is what the
   *  harnesses that care only about the gate use. */
  render?: (
    config: EmailConfig,
    request: ResetEmailRequest
  ) => { subject: string; html: string; text?: string }
  /** The from-address resolved at BOOT — server.ts's `notifyFrom`. Since #958 it is the ONLY
   *  boot-time from-address on this path (@setu/auth's `email` option no longer carries one, for
   *  the reason its doc gives). Used when the live reading has none, so an admin who
   *  clears `email.fromAddress` in Settings → Email does not silently take account recovery down:
   *  the from-address has no bearing on the credential-leak risk (that is the transport check
   *  above it), so refusing over it would cost a recovery path and buy no safety. As wired it is
   *  non-empty — server.ts builds the `email:` option only inside a branch that narrows it — so
   *  the `email_from_address_missing` refusal is defence in depth on BOTH entry points rather than
   *  reachable on one of them (#944). */
  bootFrom: string | undefined
  /** Dispatch through a reading already in hand (server.ts's `email.sendVia`). */
  sendVia: (
    transport: UsableEmailTransport,
    msg: Parameters<EmailPort['send']>[0]
  ) => Promise<void>
  adminOrigin: string | undefined
  onRefused: (refusal: ResetEmailRefusal) => void
}): ResetEmailGate {
  // #919: ONE reading per call of BOTH inputs, and what satisfied the gate is what dispatches —
  // the transport as the very object handed to `sendVia`, the from-address bound by value into the
  // message. Previously the sender resolved the transport for the gate and then dispatched
  // through a sender that resolved independently — two readings of a Git-canonical file, so a
  // `git pull`/checkout landing between them admitted the message on 'smtp' and delivered it on
  // 'console', i.e. wrote a live reset token into the server log.
  // #939 made "one reading" structural rather than a discipline: the transport and the from-address
  // arrive from a single `resolveConfig()` call, so there is no second read left to drift from —
  // and the send costs one settings parse instead of two.
  // Enforced by apps/api/test/reset-email-gate.test.ts ("delivers through the EXACT reading it
  // gated on — transport AND from-address — resolving each once"), whose stub answers DIFFERENTLY
  // on a second call so one reading is distinguishable from two; a constant stub could not tell
  // them apart, which is how the from-address half of this claim sat unenforced while the comment
  // asserted it. End-to-end: apps/api/test/reset-password-leak.test.ts.
  // #944: it is also the ONE place the fallback chain lives, so `refusal()` and `sendReset` below
  // judge the same address. `''` rather than `undefined` when nothing is configured keeps the
  // from-address a plain `string` for the message, and `resetEmailRefusal` refuses on it either way.
  // #958 extends the same reading to the BODY: `sendReset` renders from this `config` too, so the
  // reset path now costs ONE settings parse rather than two. Pinned by
  // apps/api/test/email-read-count.test.ts, 'parses settings.json exactly ONCE, and a save applies
  // to the next reset', whose liveness half also proves the reading did not become a cache.
  const decide = () => {
    const live = opts.resolveConfig()
    const from = live.from.effective ?? opts.bootFrom ?? ''
    return {
      config: live,
      from,
      refusal: resetEmailRefusal({
        from,
        adminOrigin: opts.adminOrigin,
        effectiveTransport: live.transport.effective
      })
    }
  }

  return {
    refusal: () => decide().refusal,
    sendReset: async (request) => {
      const { config, from, refusal } = decide()
      if (refusal !== null) {
        opts.onRefused(refusal)
        return
      }
      // #958: the body comes off the SAME `config` the refusal was judged against — one reading
      // decides whether to send, what to send it as, and where to send it through.
      const body = opts.render
        ? opts.render(config, request)
        : request.defaultContent()
      await opts.sendVia(config.transport, { to: request.to, from, ...body })
    }
  }
}
