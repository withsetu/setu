import type { EmailPort } from '@setu/core'
import {
  resendConfigFromEnv,
  smtpConfigFromEnv,
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

export interface EmailDispatcher {
  /**
   * Dispatch a message through an ALREADY-resolved transport reading — `sendVia(t, msg)` where
   * `t` came from the caller's own `resolveEmailConfig` (./email-config.ts).
   *
   * #919: a caller that must DECIDE on the transport before handing over a message
   * (apps/api/src/reset-email-gate.ts refuses a reset link to the console adapter) cannot resolve
   * twice — settings.json is Git-canonical, so a pull/checkout/deploy can rewrite it between the
   * two, and the gate would admit on reading A and deliver on reading B. Taking the reading as an
   * argument is what lets the decision bind the dispatch.
   *
   * It is NOT a way to freeze a transport at boot: the caller resolves per send, so the
   * live-provider property (#890) survives. That half is the CALLER's to keep, and is pinned where
   * the callers are: apps/api/test/email-read-count.test.ts drives a settings save between two
   * sends on every path (its form-notification case flips the PROVIDER itself and asserts the
   * second message lands on the other adapter), and apps/api/test/reset-email-gate.test.ts
   * ('re-resolves on every send — one reading per send, not one for the sender') drives two sends
   * through one long-lived gate with the transport changing in between. End-to-end:
   * apps/api/test/reset-password-leak.test.ts.
   */
  sendVia: (
    transport: UsableEmailTransport,
    msg: Parameters<EmailPort['send']>[0]
  ) => Promise<void>
}

/**
 * The email dispatcher: turns a resolved transport reading into an actual adapter and sends
 * through it. One object per process, adapters built lazily and cached per effective kind — an
 * instance that never selects SMTP never constructs a nodemailer transport, and switching back
 * and forth doesn't leak connections.
 *
 * #890 made the provider a CONTROL rather than a boot-time env var, and this module used to own
 * BOTH halves of that: a `provider()` getter it re-read settings.json through, plus `resolve()` /
 * `send()` entry points over it. #939 moved selection into `resolveEmailConfig`
 * (./email-config.ts), so that every send path could resolve the provider, the from-address and
 * the stored template from ONE settings parse — after which every caller in server.ts dispatched
 * through `sendVia` and nothing reached `resolve()` or `send()` at all. #959 deletes them, and the
 * `provider()` getter with them: selection now has exactly one home, and this module reads no
 * settings.
 *
 * What survives the move is the fail-safe, deliberately at the point of USE: the reading's
 * `effective` kind is what picks the adapter, so a selection whose secret is missing dispatches
 * through console with a named reason instead of constructing an adapter that throws on first
 * send. That matters most for the settings-stored provider, because settings.json is
 * Git-canonical — an unusable value can arrive by `git push` without ever passing the api's
 * settings-write gate, so a save-time check could never be the only defence. Pinned (and kill-shot
 * tested) by apps/api/test/email-transport.test.ts.
 */
export function createEmailDispatcher(opts: {
  env?: NodeJS.ProcessEnv
  adapters: EmailAdapterFactories
  /** Sink for "the selected transport isn't usable", called only when the problem CHANGES so a
   *  misconfigured instance doesn't log once per email. server.ts points it at console.error. */
  onProblem?: (problem: string, selected: string) => void
}): EmailDispatcher {
  const env = opts.env ?? process.env
  const cache = new Map<UsableEmailTransport['effective'], EmailPort>()
  let lastProblem: string | null = null

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

  /** Report the reading's problem (once per change), then hand the message to the adapter that
   *  reading names. The reporting rides the DISPATCH rather than the resolution, so a caller that
   *  resolved for itself still gets the fail-safe warning
   *  (apps/api/test/email-transport.test.ts, 'still reports the problem carried by the resolution
   *  it was handed'). */
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

  return { sendVia: dispatch }
}
