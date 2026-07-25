import { Hono } from 'hono'
import { z } from 'zod'
import { apiOnError } from './errors'

export interface AuthCapabilities {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

/** #364/#498/#890: which email transport this boot selected, and whether it's the kind of adapter
 *  that actually delivers mail anywhere. `transport` is the RESOLVED selection (settings.json's
 *  `email.provider` wins, `SETU_EMAIL_ADAPTER` is the fallback — resolveEmailProvider below);
 *  `deliverable` requires BOTH a usable real transport (usableEmailTransport below — resend
 *  with its API key, or smtp with a parseable config) AND a from-address from either source
 *  (settings.json `email.fromAddress` wins, `SETU_FORMS_NOTIFY_FROM` is the fallback —
 *  resolveFromAddress below). Both derivations are pinned by
 *  apps/api/test/capabilities.test.ts. This block is a BOOT snapshot on the unauthenticated
 *  /api/capabilities; the live per-request reading lives on the settings.view-gated
 *  GET /api/email/status (apps/api/src/email.ts). */
export interface EmailCapabilities {
  transport: string
  deliverable: boolean
}

export interface Capabilities {
  mode?: string
  capabilities: {
    imageProcessing: boolean
    writableMediaStore: boolean
    backgroundJobs: boolean
    /** #466: the git adapter implements the OPTIONAL log/readFileAt capability
     *  (revision history + restore). Derived at boot from the adapter actually
     *  having the functions — false on adapters without them (git-http/git-idb
     *  today), so the admin hides the History UI instead of showing dead
     *  controls that 409. */
    history: boolean
  }
  auth: AuthCapabilities
  email: EmailCapabilities
}

export function buildCapabilities(opts: {
  image?: unknown
  writableMediaStore: boolean
  backgroundJobs: boolean
  history: boolean
  mode?: string
  auth: AuthCapabilities
  email: EmailCapabilities
}): Capabilities {
  return {
    ...(opts.mode ? { mode: opts.mode } : {}),
    capabilities: {
      imageProcessing: !!opts.image,
      writableMediaStore: opts.writableMediaStore,
      backgroundJobs: opts.backgroundJobs,
      history: opts.history
    },
    auth: opts.auth,
    email: opts.email
  }
}

/** Parsed, validated SMTP connection config from `SETU_SMTP_*` env vars — the single parser
 *  intended to be shared by emailCapabilityFromEnv (below) and server.ts's adapter construction.
 *  apps/api/test/capabilities.test.ts pins the parser and the deliverable derivation; server.ts's
 *  construction side is not covered by that test — it holds because server.ts calls this same
 *  function on the same env, so keep it that way (don't fork a second parse there). `problem` is
 *  a human-readable, boot-log-safe reason: it may echo the (non-secret) port value, and the test
 *  above proves it never echoes SETU_SMTP_USER/SETU_SMTP_PASS values. */
export type SmtpEnvResult =
  | {
      config: {
        host: string
        port: number
        secure: boolean
        auth?: { user: string; pass: string }
      }
    }
  | { problem: string }

// TCP port: coerced because env vars are strings; integral and 1–65535 or fail closed.
const smtpPortSchema = z.coerce.number().int().min(1).max(65535)

export function smtpConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SmtpEnvResult {
  const host = env.SETU_SMTP_HOST
  if (!host) return { problem: 'SETU_SMTP_HOST is unset' }
  // 587 = mail submission, the standard client-to-relay port; Mailpit and
  // SMTPS deployments override it explicitly.
  const rawPort = env.SETU_SMTP_PORT ?? '587'
  const port = smtpPortSchema.safeParse(rawPort)
  if (!port.success) {
    return {
      problem: `SETU_SMTP_PORT is not a valid TCP port (got ${JSON.stringify(rawPort)})`
    }
  }
  const user = env.SETU_SMTP_USER
  const pass = env.SETU_SMTP_PASS
  if (Boolean(user) !== Boolean(pass)) {
    // Half-configured auth is a misconfiguration, not "no auth" — sending
    // unauthenticated to a server the operator meant to authenticate against
    // would fail confusingly at send time (or worse, silently relay). The
    // message deliberately names the variables, never their values.
    return { problem: 'SETU_SMTP_USER and SETU_SMTP_PASS must be set together' }
  }
  const secure = env.SETU_SMTP_SECURE === 'true' || env.SETU_SMTP_SECURE === '1'
  return {
    config: {
      host,
      port: port.data,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {})
    }
  }
}

/** #890: which transport the instance is asked to use, and where that instruction came from.
 *  Precedence mirrors resolveFromAddress below exactly: a non-empty settings.json
 *  `email.provider` (chosen by an admin in Settings → Email) WINS; the `SETU_EMAIL_ADAPTER` env
 *  var is the fallback for deployments configured before that control existed; console is the
 *  zero-config default. `source` names the winner (it is served on GET /api/email/status, so the
 *  order is observable), and the both-set case is pinned ORDER-SENSITIVELY by
 *  apps/api/test/capabilities.test.ts ("resolveEmailProvider" describe — swapping the two
 *  branches below fails it).
 *
 *  This resolves the CHOICE only. Whether the choice is usable — the secret may be absent — is
 *  usableEmailTransport's job, and it fails safe to console. */
export interface EmailProviderResolution {
  selected: string
  source: 'settings' | 'env' | 'default'
}

export function resolveEmailProvider(
  settingsProvider: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): EmailProviderResolution {
  if (settingsProvider)
    return { selected: settingsProvider, source: 'settings' }
  const fromEnv = env.SETU_EMAIL_ADAPTER
  if (fromEnv) return { selected: fromEnv, source: 'env' }
  return { selected: 'console', source: 'default' }
}

/** Which transport this instance selects (resolveEmailProvider above — settings win, env
 *  fallback), and whether it is actually USABLE — the one predicate server.ts's adapter
 *  resolution, emailCapabilityFromEnv (below) and the /api/email/status thunk all share, so
 *  "which adapter sends the next email" and "what the admin screen reports" can't drift
 *  (apps/api/test/capabilities.test.ts pins every branch):
 *  - resend needs RESEND_API_KEY (#885 review Finding 2 — a keyless resend adapter throws on
 *    first send, so it must not count as a real transport);
 *  - smtp needs a parseable SETU_SMTP_* config (#256, via smtpConfigFromEnv);
 *  - anything else (console, unset, unrecognized) is the console fallback.
 *  `problem` is a boot-log-safe reason naming the missing/broken variable, never a value.
 *
 *  #890: this is ALSO the fail-safe for a provider stored in settings.json. That file is
 *  Git-canonical, so an unusable value can arrive by `git push` without passing through the
 *  api's settings-write gate — which is why the degradation lives here, at the point of use,
 *  rather than only at the point of save. */
export type UsableEmailTransport = {
  /** The resolved transport name (settings > env > 'console'), verbatim. */
  selected: string
  /** Which source chose it. */
  source: EmailProviderResolution['source']
  /** The adapter kind that should actually be constructed for this selection. */
  effective: 'console' | 'resend' | 'smtp'
  /** Why a selected real transport fell back to console (null when nothing fell back —
   *  including the unrecognized-value case, which the caller reports via `selected`). */
  problem: string | null
}

export function usableEmailTransport(
  env: NodeJS.ProcessEnv = process.env,
  settingsProvider?: string
): UsableEmailTransport {
  const { selected, source } = resolveEmailProvider(settingsProvider, env)
  if (selected === 'resend') {
    if (env.RESEND_API_KEY)
      return { selected, source, effective: 'resend', problem: null }
    return {
      selected,
      source,
      effective: 'console',
      problem: 'RESEND_API_KEY is unset'
    }
  }
  if (selected === 'smtp') {
    const smtp = smtpConfigFromEnv(env)
    if ('config' in smtp)
      return { selected, source, effective: 'smtp', problem: null }
    return { selected, source, effective: 'console', problem: smtp.problem }
  }
  return { selected, source, effective: 'console', problem: null }
}

/** #890: per-transport usability for the admin's provider dropdown. Deliberately INDEPENDENT of
 *  which transport is currently selected — the screen has to disable the options it cannot honor
 *  and say what to add, which the selected transport alone can't tell it. `problem` is
 *  remediation copy naming the env var to set; like every string on this surface it never echoes
 *  a credential value (apps/api/test/capabilities.test.ts asserts that for the SMTP auth case).
 *  Console is always offered: it is the honest "log it, don't send it" choice and needs no
 *  secret, so the picker can never end up with zero selectable options. */
export interface EmailTransportOption {
  id: 'console' | 'resend' | 'smtp'
  usable: boolean
  problem: string | null
}

export function emailTransportOptions(
  env: NodeJS.ProcessEnv = process.env
): EmailTransportOption[] {
  const smtp = smtpConfigFromEnv(env)
  const smtpUsable = 'config' in smtp
  return [
    { id: 'console', usable: true, problem: null },
    {
      id: 'resend',
      usable: Boolean(env.RESEND_API_KEY),
      problem: env.RESEND_API_KEY
        ? null
        : 'Add RESEND_API_KEY to the server environment to enable Resend.'
    },
    {
      id: 'smtp',
      usable: smtpUsable,
      problem: smtpUsable
        ? null
        : !env.SETU_SMTP_HOST
          ? 'Add SETU_SMTP_HOST to the server environment to enable SMTP.'
          : // Host is present but the rest of the config is broken — the specific reason is
            // more useful than "add SETU_SMTP_HOST", and smtpConfigFromEnv's problem strings
            // are credential-safe by construction.
            `SMTP is misconfigured: ${'problem' in smtp ? smtp.problem : ''}. Fix it in the server environment.`
    }
  ]
}

/** The one from-address the instance sends everything from, resolved with the #498 precedence:
 *  a non-empty settings.json `email.fromAddress` WINS; the `SETU_FORMS_NOTIFY_FROM` env var is
 *  the fallback for deployments configured before the Settings → Email screen existed. `source`
 *  names the winner (it is served on GET /api/email/status, so the order is observable), and the
 *  both-set case is pinned order-sensitively by apps/api/test/capabilities.test.ts
 *  ("resolveFromAddress" describe — swapping the two branches below fails it). */
export interface FromAddressResolution {
  effective: string | null
  source: 'settings' | 'env' | null
}

export function resolveFromAddress(
  settingsFromAddress: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): FromAddressResolution {
  if (settingsFromAddress)
    return { effective: settingsFromAddress, source: 'settings' }
  const fromEnv = env.SETU_FORMS_NOTIFY_FROM
  if (fromEnv) return { effective: fromEnv, source: 'env' }
  return { effective: null, source: null }
}

/** The boot-time email capability block for /api/capabilities. Built on the same two helpers
 *  above that server.ts wires the adapter and the /api/email/status thunk from, so this can't
 *  claim a transport is live that server.ts didn't actually construct.
 *
 *  `deliverable` = a USABLE real transport (usableEmailTransport) AND a from-address from either
 *  source (resolveFromAddress — settings win, env fallback; #364 required the from because
 *  server.ts only wires createAuth's `email:` option when one exists). Exposure stays exactly
 *  what it was: the transport name + one boolean — secret PRESENCE never appears here (this
 *  endpoint is unauthenticated; presence booleans live on the settings.view-gated
 *  GET /api/email/status instead). */
export function emailCapabilityFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  settingsFromAddress?: string,
  settingsProvider?: string
): EmailCapabilities {
  const usable = usableEmailTransport(env, settingsProvider)
  const from = resolveFromAddress(settingsFromAddress, env)
  return {
    transport: usable.selected,
    deliverable: usable.effective !== 'console' && from.effective !== null
  }
}

/** capabilities is mostly boot-time-static (image adapter, storage, mode), but the `auth` block's
 *  `needsSetup` flag is NOT — it depends on the current user-table row count, which changes the
 *  moment first-run setup creates the owner account. So `createCapabilitiesApi` takes the static
 *  shape plus a thunk for the auth block, and calls the thunk fresh on every request rather than
 *  baking a snapshot into the response returned once at boot. */
export function createCapabilitiesApi(
  base: Omit<Capabilities, 'auth'>,
  resolveAuth: () => AuthCapabilities
) {
  const app = new Hono()
  app.get('/api/capabilities', (c) => c.json({ ...base, auth: resolveAuth() }))
  app.onError(apiOnError({ scope: 'capabilities' })) // #291: e.g. a throwing resolveAuth thunk
  return app
}
