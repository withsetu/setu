import type { EmailPort } from '@setu/core'
import {
  resendConfigFromEnv,
  smtpConfigFromEnv,
  usableEmailTransport,
  type ResendEnvResult,
  type SmtpEnvResult,
  type UsableEmailTransport
} from './capabilities'

/** The parsed SMTP connection config `smtpConfigFromEnv` yields — named here so the adapter
 *  factory below can be typed without this module importing a concrete adapter. */
export type SmtpConfig = Extract<SmtpEnvResult, { config: unknown }>['config']

/** #930: everything the resend adapter is constructed from — the api key plus the env-derived
 *  request bound. Previously the factory took the bare api key, which left the adapter no way to
 *  hear about `SETU_RESEND_TIMEOUT_MS`; this mirrors {@link SmtpConfig} so both adapters are
 *  constructed from one parsed config rather than one being special. */
export type ResendConfig = { apiKey: string } & Extract<
  ResendEnvResult,
  { config: unknown }
>['config']

/** Adapter constructors, injected by server.ts. Keeping them out of this module is what makes
 *  the seam unit-testable (apps/api/test/email-transport.test.ts swaps in spies) and keeps the
 *  Node-only smtp adapter out of the import graph until it is actually chosen. */
export interface EmailAdapterFactories {
  console: () => EmailPort
  resend: (config: ResendConfig) => EmailPort
  smtp: (config: SmtpConfig) => EmailPort
}

export interface LiveEmailTransport {
  /** What the NEXT send would use, resolved from the current settings + env. */
  resolve: () => UsableEmailTransport
  /** An `EmailPort['send']` that re-resolves the transport on every call. */
  send: EmailPort['send']
  /**
   * #919: dispatch through an ALREADY-resolved reading — `sendVia(t, msg)` where `t` came from
   * `resolve()`. For a caller that must DECIDE on the transport before handing over a message
   * (apps/api/src/reset-email-gate.ts refuses a reset link to the console adapter), `resolve()`
   * followed by `send()` is two independent readings, and settings.json is Git-canonical: a
   * pull/checkout/deploy can rewrite it between them, so the gate would admit on reading A and
   * deliver on reading B. This is the seam that lets the decision bind the dispatch.
   *
   * It is NOT a way to freeze a transport at boot: the caller still resolves per send, so the
   * live-provider property (#890) survives — the reading is just used once instead of twice.
   * Pinned at BOTH levels, because the seam and its caller can each break it independently:
   * this module by apps/api/test/email-transport.test.ts ("sendVia binds a caller-resolved
   * reading"), and the reset gate — the one caller that resolves for itself — by
   * apps/api/test/reset-email-gate.test.ts ("re-resolves on every send"), which drives two sends
   * through one long-lived sender with the provider changing in between. End-to-end:
   * apps/api/test/reset-password-leak.test.ts.
   */
  sendVia: (
    transport: UsableEmailTransport,
    msg: Parameters<EmailPort['send']>[0]
  ) => Promise<void>
}

/**
 * #890: the live email transport — the seam that makes the provider a CONTROL rather than a
 * boot-time env var.
 *
 * Increment A (#498) constructed one adapter at boot from `SETU_EMAIL_ADAPTER`, so switching
 * provider would have required an api restart. Here the transport is re-resolved per send from
 * `provider()` (server.ts re-reads settings.json) plus the environment, exactly like the
 * from-address already was — so a save in Settings → Email applies to the next email through
 * every consumer that uses this sender.
 *
 * Fail-safe, and deliberately at the point of USE: `usableEmailTransport` decides the `effective`
 * adapter, so a selection whose secret is missing degrades to console with a named reason instead
 * of constructing an adapter that throws on first send. That matters most for the settings-stored
 * provider, because settings.json is Git-canonical — an unusable value can arrive by `git push`
 * without ever passing the api's settings-write gate, so a save-time check could never be the
 * only defence. Pinned (and kill-shot tested) by apps/api/test/email-transport.test.ts.
 *
 * Adapters are built lazily and cached per effective kind: an instance that never selects SMTP
 * never constructs a nodemailer transport, and switching back and forth doesn't leak connections.
 */
export function createLiveEmailTransport(opts: {
  env?: NodeJS.ProcessEnv
  /** Live getter for settings.json's `email.provider`. May throw (unreadable file) — treated as
   *  "not set here", which falls back to the env selection rather than failing the send. */
  provider: () => string | undefined
  adapters: EmailAdapterFactories
  /** Sink for "the selected transport isn't usable", called only when the problem CHANGES so a
   *  misconfigured instance doesn't log once per email. server.ts points it at console.error. */
  onProblem?: (problem: string, selected: string) => void
}): LiveEmailTransport {
  const env = opts.env ?? process.env
  const cache = new Map<UsableEmailTransport['effective'], EmailPort>()
  let lastProblem: string | null = null

  const resolve = (): UsableEmailTransport => {
    let stored: string | undefined
    try {
      stored = opts.provider()
    } catch {
      // An unreadable/corrupt settings.json must not take email down: fall back to the env
      // selection, which is exactly the pre-#890 behavior.
      stored = undefined
    }
    return usableEmailTransport(env, stored)
  }

  const adapterFor = (kind: UsableEmailTransport['effective']): EmailPort => {
    const cached = cache.get(kind)
    if (cached) return cached
    let made: EmailPort
    if (kind === 'resend') {
      const resend = resendConfigFromEnv(env)
      // Unreachable: `effective` is only 'resend' when resendConfigFromEnv parsed (same call, same
      // env) — see usableEmailTransport. Defensive for the same reason the smtp arm below is: a
      // future change on either side degrades to console rather than constructing an adapter whose
      // request bound silently went missing.
      made =
        'config' in resend
          ? opts.adapters.resend({
              apiKey: env.RESEND_API_KEY ?? '',
              ...resend.config
            })
          : opts.adapters.console()
    } else if (kind === 'smtp') {
      const smtp = smtpConfigFromEnv(env)
      // Unreachable: `effective` is only 'smtp' when smtpConfigFromEnv parsed (same call, same
      // env) — see usableEmailTransport. Defensive, so a future change to either side degrades
      // to console instead of constructing a transport from nothing.
      made =
        'config' in smtp
          ? opts.adapters.smtp(smtp.config)
          : opts.adapters.console()
    } else {
      made = opts.adapters.console()
    }
    cache.set(kind, made)
    return made
  }

  /** The one dispatch path: report the reading's problem (once per change), then hand the
   *  message to the adapter that reading names. `send` and `sendVia` differ ONLY in who resolved
   *  — which is what keeps the fail-safe reporting on both (apps/api/test/email-transport.test.ts,
   *  "still reports the problem carried by the resolution it was handed"). */
  const dispatch = async (
    transport: UsableEmailTransport,
    msg: Parameters<EmailPort['send']>[0]
  ): Promise<void> => {
    if (transport.problem !== null && transport.problem !== lastProblem) {
      lastProblem = transport.problem
      opts.onProblem?.(transport.problem, transport.selected)
    } else if (transport.problem === null) {
      lastProblem = null
    }
    await adapterFor(transport.effective).send(msg)
  }

  return {
    resolve,
    sendVia: dispatch,
    send: async (msg) => {
      await dispatch(resolve(), msg)
    }
  }
}
