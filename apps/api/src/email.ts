import { Hono } from 'hono'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { EmailPort } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor, ResolvedActor } from './auth/resolve-actor'
import {
  emailDeliverable,
  emailTransportOptions,
  publicFrom,
  type EmailTransportOption,
  type PublicFromAddress,
  type UsableEmailTransport
} from './capabilities'
import type { EmailConfig } from './email-config'
import { apiOnError } from './errors'
import { createWindowLimiter } from './rate-limit'

const authz = createAuthz(DEFAULT_ROLES)

/** What the admin's Settings → Email screen needs to render an HONEST provider status
 *  (#498, epic #497). Everything here is presence/derivation only — never key material:
 *  `secrets` carries booleans (and smtpConfigFromEnv's boot-log-safe `problem` string,
 *  which apps/api/test/capabilities.test.ts proves never echoes credential values). */
export interface EmailStatus {
  /** The RESOLVED transport selection, verbatim — settings.json's `email.provider` wins,
   *  `SETU_EMAIL_ADAPTER` is the fallback (#890, resolveEmailProvider). Same convention as
   *  /api/capabilities' email block. */
  transport: string
  /** Which source chose it, so the screen can say whether the dropdown or the environment is
   *  in charge (#890). */
  providerSource: 'settings' | 'env' | 'default'
  /** Per-transport usability for the provider dropdown — the options whose secret is absent
   *  render disabled with `problem` as their remediation (#890). Independent of which one is
   *  selected; console is always usable. */
  transports: EmailTransportOption[]
  /** The adapter the NEXT send would use ('console' when the selection fell back). Live, not a
   *  boot snapshot: since #890 the transport is re-resolved per send. */
  effectiveTransport: 'console' | 'resend' | 'smtp'
  /** Live "would an email actually go out": real transport AND a from-address resolvable
   *  RIGHT NOW (settings win, env fallback) — unlike /api/capabilities' boot snapshot. */
  deliverable: boolean
  mode: string
  /** The from-address that would be used for the next send, which source won, and — since #953 —
   *  why a SET `SETU_FORMS_NOTIFY_FROM` was rejected, so the screen can say "the server's value
   *  isn't usable" instead of "not set". Built by capabilities.ts's `publicFrom`, whose key set
   *  is pinned by apps/api/test/capabilities.test.ts; do not widen it with a spread here. */
  from: PublicFromAddress
  secrets: {
    resendApiKey: boolean
    smtpConfigured: boolean
    smtpProblem: string | null
  }
  /** #885 review Finding 1: password reset's ENABLE gate is wired once at boot (createAuth's
   *  `email:` option in server.ts) — unlike test-send and form notifications, it cannot pick
   *  up a from-address saved after boot until the server restarts. True exactly when a restart
   *  alone would turn reset on; the screen renders it as an explicit "after the server
   *  restarts" line. Derivation: resetRestartRequired below. Making the gate live is #886. */
  resetRestartRequired: boolean
}

/** True exactly when restarting the server would newly enable password-reset emails: reset was
 *  NOT wired at boot (no from-address existed then), and the live config now has everything the
 *  boot wiring needs (auth configured, an admin origin for the reset link, a from-address, and
 *  — since #894 — an effective transport that is not the console adapter).
 *  Pinned by apps/api/test/email-api.test.ts ("resetRestartRequired" describe). */
export function resetRestartRequired(opts: {
  resetWiredAtBoot: boolean
  authConfigured: boolean
  adminOriginPresent: boolean
  liveFrom: string | null
  /** #894: `usableEmailTransport(...).effective !== 'console'` read LIVE. Reset is gated on a
   *  transport that can actually deliver, so while the console adapter is effective a restart
   *  would change nothing — promising one would be a lie on the Settings → Email screen. */
  liveTransportReal: boolean
}): boolean {
  return (
    !opts.resetWiredAtBoot &&
    opts.authConfigured &&
    opts.adminOriginPresent &&
    opts.liveFrom !== null &&
    opts.liveTransportReal
  )
}

/** The boot-time facts `buildEmailStatus` folds in alongside the live reading. All four are
 *  fixed for the process's lifetime, which is exactly why they are separate from the config:
 *  server.ts binds them once and the thunk below only ever resolves what can change. */
export interface EmailStatusContext {
  env: NodeJS.ProcessEnv
  mode: string
  /** The `resetWiredAtBoot` const server.ts also hands to createAuth's `email:` option, ANDed
   *  with "auth exists at all" — so this cannot report a gate the server does not have. */
  resetWiredAtBoot: boolean
  authConfigured: boolean
  adminOriginPresent: boolean
}

/**
 * The `GET /api/email/status` payload, built from ONE live reading (#938).
 *
 * This was an inline literal in apps/api/src/server.ts — a side-effectful entrypoint no test
 * imports, so the production copy was unexercised while three hand-written near-copies stood in
 * for it (the live harness in apps/api/test/email-api.test.ts, which had already dropped the
 * from-address half of `deliverable`, and a fourth shape hand-written in
 * apps/admin/test/email-settings.test.tsx). Extracting it is what makes the mutation testable:
 * dropping either half of `emailDeliverable` now fails apps/api/test/email-status.test.ts and
 * apps/api/test/capabilities.test.ts instead of nothing at all.
 *
 * `deliverable` is `emailDeliverable` from ./capabilities — the SAME function
 * `emailCapabilityFromEnv` calls for /api/capabilities, not a re-typing of the expression, so the
 * unauthenticated capability block and this settings.view-gated one cannot drift apart. That
 * drift had a user-visible shape: with a real transport and no from-address, the admin's
 * Settings → Email screen would say "Ready to send" over the exact state
 * `POST /api/email/test-send` answers 409 `no_from_address` on.
 */
export function buildEmailStatus(
  config: Pick<EmailConfig, 'from' | 'transport'>,
  ctx: EmailStatusContext
): EmailStatus {
  const { from, transport } = config
  const transports = emailTransportOptions(ctx.env)
  return {
    transport: transport.selected,
    providerSource: transport.source,
    transports,
    effectiveTransport: transport.effective,
    deliverable: emailDeliverable(transport, from),
    mode: ctx.mode,
    // capabilities.ts's projection (#953), not a spread and not a hand-written literal: a
    // literal here would be enforced by nothing (excess-property checking does not apply to a
    // variable in a property position, so `from,` typechecks clean), whereas publicFrom's key
    // set is pinned by apps/api/test/capabilities.test.ts. Extracting this builder out of
    // server.ts (#938) is what put the projection somewhere a test can reach it at all.
    from: publicFrom(from),
    secrets: {
      resendApiKey: Boolean(ctx.env.RESEND_API_KEY),
      // Selection-INDEPENDENT since #890: the picker has to say whether SMTP could be
      // chosen, which the currently-selected transport can't answer.
      smtpConfigured: transports.find((t) => t.id === 'smtp')?.usable ?? false,
      smtpProblem: transport.selected === 'smtp' ? transport.problem : null
    },
    // When reset was off at boot but the live config would now satisfy it, only a restart turns
    // reset on — say so (#885 review Finding 1). `liveTransportReal` is the #894 half: a restart
    // cannot enable reset while the effective transport is still the console adapter, so
    // promising one would be a lie.
    resetRestartRequired: resetRestartRequired({
      resetWiredAtBoot: ctx.resetWiredAtBoot,
      authConfigured: ctx.authConfigured,
      adminOriginPresent: ctx.adminOriginPresent,
      liveFrom: from.effective,
      liveTransportReal: transport.effective !== 'console'
    })
  }
}

export interface EmailApiOptions {
  resolveActor: ResolveActor
  /**
   * ONE live reading of settings.json + env per call (#939). server.ts points this at
   * `createLiveEmailConfig`, so a from-address, provider or template saved in the admin applies
   * without an api restart — the read still happens inside the request, it just happens once
   * instead of three times.
   *
   * #919: it is also what makes the test-send self-consistent. A `status` GET and a later
   * test-send POST still read independently — settings can legitimately change in between, and
   * that is the feature — but WITHIN one POST the reading that labels the outcome IS the reading
   * that sent, because there is only one. Previously the route resolved the transport for its
   * report and again for its dispatch, so a settings.json rewrite between the two made the
   * screen say "sent" over a message the console adapter had logged. Both properties are pinned
   * by apps/api/test/email-api.test.ts ("labels the outcome from the reading it actually
   * dispatched through, even when the provider flips mid-request", which asserts the read count
   * as well as the agreement — a self-consistency assertion alone would be vacuous once the
   * second read is gone).
   */
  resolveConfig: () => EmailConfig
  /** The boot-fixed half of the status payload; see EmailStatusContext. */
  statusContext: EmailStatusContext
  /** Dispatch through a reading already in hand (server.ts's `email.sendVia`). Structural, like
   *  the `send` it replaces — this factory never imports a concrete adapter. */
  sendVia: (
    transport: UsableEmailTransport,
    msg: Parameters<EmailPort['send']>[0]
  ) => Promise<void>
  /** Injectable clock for the rate-limiter tests. */
  now?: () => number
}

/** Test-send bound: 3 sends per actor per minute. Small and in-process on purpose — the
 *  route is admin-only and per-actor, so this is a belt against a runaway click-loop or a
 *  compromised admin session being used as a mail cannon, not a distributed-abuse defence.
 *  #918 moved the Map-of-timestamps itself into rate-limit.ts (the anonymous /forms/submit path
 *  needed two more bounds of the same shape); the numbers and the behaviour here are unchanged —
 *  apps/api/test/email-api.test.ts is untouched and apps/api/test/rate-limit.test.ts re-drives
 *  this exact 3-per-60s sequence against the extracted helper. No `maxKeys`: actor ids come from
 *  the user table, a bounded server-side set, so there is nothing here for a caller to inflate. */
const RATE_MAX = 3
const RATE_WINDOW_MS = 60_000

/** Settings → Email control plane (#498):
 *
 *  - `GET  /api/email/status`   — `settings.view` (maintainer+, the same visibility as the
 *    Settings surface itself). Presence booleans only; never key material.
 *  - `POST /api/email/test-send` — `settings.manage` (admin), the SAME action the settings
 *    write gate maps settings.json to (PATH_WRITE_ACTION in app.ts), so "may change email
 *    settings" and "may fire a test email" are one permission. Fail-closed ladder:
 *    401 unauth → 403 wrong actor → 429 rate-limited → 409 no from-address → send.
 *
 *  Spam-relay guard: the recipient is ALWAYS the signed-in actor's own account email —
 *  the request body is never read, so there is nothing to abuse as an arbitrary-recipient
 *  relay. Authz, recipient-fixing and the rate limit are pinned (kill-shot tested) by
 *  apps/api/test/email-api.test.ts. */
export function createEmailApi(opts: EmailApiOptions) {
  const now = opts.now ?? Date.now
  const app = new Hono<{ Variables: { actor: ResolvedActor } }>()
  // actor id → send timestamps inside the current window (pruned on every check).
  const limiter = createWindowLimiter({
    max: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
    ...(opts.now ? { now: opts.now } : {})
  })

  app.get('/api/email/status', authMiddleware(opts.resolveActor), (c) => {
    if (!authz.can(c.get('actor'), 'settings.view'))
      return c.json({ error: 'forbidden' }, 403)
    return c.json(buildEmailStatus(opts.resolveConfig(), opts.statusContext))
  })

  app.post(
    '/api/email/test-send',
    authMiddleware(opts.resolveActor),
    async (c) => {
      const actor = c.get('actor')
      if (!authz.can(actor, 'settings.manage'))
        return c.json({ error: 'forbidden' }, 403)

      const t = now()
      if (!limiter.check(actor.id)) {
        return c.json(
          { error: 'rate_limited', retryAfterMs: RATE_WINDOW_MS },
          429
        )
      }

      // #939: ONE reading for the whole request — the 409 gate below, the `Transport:` stamp,
      // the dispatch and the result label all come from it. Previously the route called
      // `status()` (two settings parses) and then `resolveTransport()` (a third).
      const config = opts.resolveConfig()
      const from = config.from.effective
      if (!from)
        return c.json(
          {
            error: 'no_from_address',
            message:
              'No from-address is configured — set one in Settings → Email or via SETU_FORMS_NOTIFY_FROM.'
          },
          409
        )

      // The recipient is the ACTOR, full stop — resolveSessionActor always stamps the session
      // user's email into gitAuthor. Its absence means we have no address on file, so refuse
      // rather than guess (only the sessionless resolveLocalOwner path lacks it, and that
      // topology has no real transport to reach anyway).
      const to = actor.gitAuthor?.email
      if (!to)
        return c.json(
          {
            error: 'no_recipient',
            message: 'Your account has no email address to send the test to.'
          },
          409
        )

      limiter.record(actor.id)

      const sentAt = new Date(t).toISOString()
      // #919: ONE reading, used for the 409 gate above, the body's `Transport:` stamp, the
      // dispatch, and the result label below — so none of them can disagree. Since #939 that is
      // structural rather than a discipline: there is no second read left in this handler to
      // drift from.
      const live = config.transport
      try {
        await opts.sendVia(live, {
          to,
          from,
          subject: 'Setu test email',
          html:
            '<p>This is a test email from your Setu site.</p>' +
            '<p>If you are reading this in your inbox, outbound email is working.</p>' +
            `<p>Transport: ${live.effective} · Sent: ${sentAt}</p>`,
          text:
            'This is a test email from your Setu site.\n' +
            'If you are reading this in your inbox, outbound email is working.\n' +
            `Transport: ${live.effective} · Sent: ${sentAt}`
        })
      } catch (err) {
        // Honest failed-with-reason: this surface is admin-only and the adapters' errors are
        // transport diagnostics (DNS, connect, HTTP status) — useful, and never credentials.
        const reason =
          err instanceof Error ? err.message.slice(0, 300) : 'unknown error'
        return c.json({ error: 'send_failed', reason }, 502)
      }

      // Honest result: the console adapter LOGS instead of delivering — never dress that up
      // as "sent" (card #7's saved≠live cousin: logged ≠ delivered). Reported from `live`, the
      // reading that actually dispatched above, so this can no longer describe a different
      // transport than the one that handled the message (#919).
      return c.json({
        result: live.effective === 'console' ? 'logged' : 'sent',
        transport: live.effective,
        to
      })
    }
  )

  app.onError(apiOnError({ scope: 'email' }))
  return app
}
