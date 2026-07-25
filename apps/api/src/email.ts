import { Hono } from 'hono'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { EmailPort } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor, ResolvedActor } from './auth/resolve-actor'
import type { EmailTransportOption } from './capabilities'
import { apiOnError } from './errors'

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
  /** The from-address that would be used for the next send, and which source won. */
  from: { effective: string | null; source: 'settings' | 'env' | null }
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
 *  boot wiring needs (auth configured, an admin origin for the reset link, a from-address).
 *  Pinned by apps/api/test/email-api.test.ts ("resetRestartRequired" describe). */
export function resetRestartRequired(opts: {
  resetWiredAtBoot: boolean
  authConfigured: boolean
  adminOriginPresent: boolean
  liveFrom: string | null
}): boolean {
  return (
    !opts.resetWiredAtBoot &&
    opts.authConfigured &&
    opts.adminOriginPresent &&
    opts.liveFrom !== null
  )
}

export interface EmailApiOptions {
  resolveActor: ResolveActor
  /** Live status thunk — server.ts re-reads settings.json per call so a from-address or
   *  provider saved in the admin applies without an api restart. */
  status: () => EmailStatus
  /** The live sender (structural EmailPort['send'], like @setu/auth's email option — this
   *  factory never imports a concrete adapter). Since #890 it re-resolves the transport per call
   *  from the same settings + env that `status` reads, and both derive it through the one shared
   *  predicate (usableEmailTransport), so they are intended to agree about which transport is
   *  effective. They remain two INDEPENDENT readings, not one, at every level: a `status` GET and
   *  a later test-send POST can legitimately disagree if settings changed in between — that is
   *  the feature — and even inside one POST the `transport` this route reports comes from its own
   *  `opts.status()` call while the adapter that sent re-resolved separately. Nothing here
   *  enforces that those two agree; they are expected to, because both read the same two sources
   *  through the same predicate a few microseconds apart. */
  send: EmailPort['send']
  /** Injectable clock for the rate-limiter tests. */
  now?: () => number
}

/** Test-send bound: 3 sends per actor per minute. Small and in-process on purpose — the
 *  route is admin-only and per-actor, so this is a belt against a runaway click-loop or a
 *  compromised admin session being used as a mail cannon, not a distributed-abuse defence. */
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
  const recent = new Map<string, number[]>()

  app.get('/api/email/status', authMiddleware(opts.resolveActor), (c) => {
    if (!authz.can(c.get('actor'), 'settings.view'))
      return c.json({ error: 'forbidden' }, 403)
    return c.json(opts.status())
  })

  app.post(
    '/api/email/test-send',
    authMiddleware(opts.resolveActor),
    async (c) => {
      const actor = c.get('actor')
      if (!authz.can(actor, 'settings.manage'))
        return c.json({ error: 'forbidden' }, 403)

      const t = now()
      const stamps = (recent.get(actor.id) ?? []).filter(
        (s) => t - s < RATE_WINDOW_MS
      )
      if (stamps.length >= RATE_MAX) {
        recent.set(actor.id, stamps)
        return c.json(
          { error: 'rate_limited', retryAfterMs: RATE_WINDOW_MS },
          429
        )
      }

      const status = opts.status()
      const from = status.from.effective
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

      stamps.push(t)
      recent.set(actor.id, stamps)

      const sentAt = new Date(t).toISOString()
      try {
        await opts.send({
          to,
          from,
          subject: 'Setu test email',
          html:
            '<p>This is a test email from your Setu site.</p>' +
            '<p>If you are reading this in your inbox, outbound email is working.</p>' +
            `<p>Transport: ${status.effectiveTransport} · Sent: ${sentAt}</p>`,
          text:
            'This is a test email from your Setu site.\n' +
            'If you are reading this in your inbox, outbound email is working.\n' +
            `Transport: ${status.effectiveTransport} · Sent: ${sentAt}`
        })
      } catch (err) {
        // Honest failed-with-reason: this surface is admin-only and the adapters' errors are
        // transport diagnostics (DNS, connect, HTTP status) — useful, and never credentials.
        const reason =
          err instanceof Error ? err.message.slice(0, 300) : 'unknown error'
        return c.json({ error: 'send_failed', reason }, 502)
      }

      // Honest result: the console adapter LOGS instead of delivering — never dress that up
      // as "sent" (card #7's saved≠live cousin: logged ≠ delivered).
      return c.json({
        result: status.effectiveTransport === 'console' ? 'logged' : 'sent',
        transport: status.effectiveTransport,
        to
      })
    }
  )

  app.onError(apiOnError({ scope: 'email' }))
  return app
}
