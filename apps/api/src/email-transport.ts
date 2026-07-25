import type { EmailPort } from '@setu/core'
import {
  smtpConfigFromEnv,
  usableEmailTransport,
  type SmtpEnvResult,
  type UsableEmailTransport
} from './capabilities'

/** The parsed SMTP connection config `smtpConfigFromEnv` yields — named here so the adapter
 *  factory below can be typed without this module importing a concrete adapter. */
export type SmtpConfig = Extract<SmtpEnvResult, { config: unknown }>['config']

/** Adapter constructors, injected by server.ts. Keeping them out of this module is what makes
 *  the seam unit-testable (apps/api/test/email-transport.test.ts swaps in spies) and keeps the
 *  Node-only smtp adapter out of the import graph until it is actually chosen. */
export interface EmailAdapterFactories {
  console: () => EmailPort
  resend: (apiKey: string) => EmailPort
  smtp: (config: SmtpConfig) => EmailPort
}

export interface LiveEmailTransport {
  /** What the NEXT send would use, resolved from the current settings + env. */
  resolve: () => UsableEmailTransport
  /** An `EmailPort['send']` that re-resolves the transport on every call. */
  send: EmailPort['send']
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
      made = opts.adapters.resend(env.RESEND_API_KEY ?? '')
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

  return {
    resolve,
    send: async (msg) => {
      const transport = resolve()
      if (transport.problem !== null && transport.problem !== lastProblem) {
        lastProblem = transport.problem
        opts.onProblem?.(transport.problem, transport.selected)
      } else if (transport.problem === null) {
        lastProblem = null
      }
      await adapterFor(transport.effective).send(msg)
    }
  }
}
