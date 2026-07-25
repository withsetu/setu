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
 *  apps/api/test/capabilities.test.ts. Since #890 this block is resolved PER REQUEST on the
 *  unauthenticated /api/capabilities (createCapabilitiesApi's `resolveEmail` thunk) — a settings
 *  save must not need a restart to stop the admin's reset surfaces claiming reset is
 *  unconfigured. It stays deliberately narrow (transport name + one boolean); the richer,
 *  presence-bearing reading lives on the settings.view-gated GET /api/email/status
 *  (apps/api/src/email.ts). */
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
        /** #928: ms overrides for the adapter's bounded socket timeouts. Absent means the
         *  adapter's own seconds-scale default (SMTP_TIMEOUT_DEFAULTS in
         *  packages/email-smtp/src/index.ts) — never nodemailer's minutes-scale one. */
        connectionTimeout?: number
        greetingTimeout?: number
        socketTimeout?: number
        dnsTimeout?: number
      }
    }
  | { problem: string }

// TCP port: coerced because env vars are strings; integral and 1–65535 or fail closed.
const smtpPortSchema = z.coerce.number().int().min(1).max(65535)

/** #928: a timeout override in ms. Positive integer or fail closed — a typo'd value must be a
 *  named boot problem, never a silent fall-back to nodemailer's multi-minute default, which is
 *  the exact stall this bounds. Capped at an hour so a stray "60000000" cannot restore it either.
 *  Pinned by apps/api/test/capabilities.test.ts ("smtp timeout overrides"). */
const smtpTimeoutSchema = z.coerce.number().int().min(1).max(3_600_000)

/** env var → the SmtpEmailAdapterOptions field it overrides. */
const SMTP_TIMEOUT_VARS = [
  ['SETU_SMTP_CONNECTION_TIMEOUT_MS', 'connectionTimeout'],
  ['SETU_SMTP_GREETING_TIMEOUT_MS', 'greetingTimeout'],
  ['SETU_SMTP_SOCKET_TIMEOUT_MS', 'socketTimeout'],
  ['SETU_SMTP_DNS_TIMEOUT_MS', 'dnsTimeout']
] as const

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
  const timeouts: Record<string, number> = {}
  for (const [varName, field] of SMTP_TIMEOUT_VARS) {
    const raw = env[varName]
    if (raw === undefined || raw === '') continue
    const parsed = smtpTimeoutSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        problem: `${varName} is not a positive whole number of milliseconds (got ${JSON.stringify(raw)})`
      }
    }
    timeouts[field] = parsed.data
  }
  return {
    config: {
      host,
      port: port.data,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
      ...timeouts
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

/** The transports Setu can actually construct. An id outside this set is a misconfiguration,
 *  not a capability gap — see KNOWN_TRANSPORTS' use in usableEmailTransport below. */
const KNOWN_TRANSPORTS = ['console', 'resend', 'smtp'] as const

/** `['a','b','c']` → `'a, b or c'`, so the remediation copy lists whatever KNOWN_TRANSPORTS
 *  actually holds instead of a hand-maintained sentence that can drift from it. */
const orList = (items: readonly string[]): string =>
  items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`

/** Which transport this instance selects (resolveEmailProvider above — settings win, env
 *  fallback), and whether it is actually USABLE — the one predicate server.ts's adapter
 *  resolution, emailCapabilityFromEnv (below) and the /api/email/status thunk all share, so
 *  "which adapter sends the next email" and "what the admin screen reports" can't drift
 *  (apps/api/test/capabilities.test.ts pins every branch):
 *  - resend needs RESEND_API_KEY (#885 review Finding 2 — a keyless resend adapter throws on
 *    first send, so it must not count as a real transport);
 *  - smtp needs a parseable SETU_SMTP_* config (#256, via smtpConfigFromEnv);
 *  - an id outside KNOWN_TRANSPORTS falls back to console AND names the typo (#942);
 *  - console / unset / '' is the silent zero-config default.
 *  `problem` is a boot-log-safe reason naming the missing/broken variable, never a value —
 *  except a transport id, which is a selection, never a credential.
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
  /** Why the selection fell back to console: a missing secret, a broken SMTP config, or (#942)
   *  an id Setu does not know. Null when nothing fell back, and null for the plain console
   *  default — unset/'' is "not configured", which is the normal zero-config state and must not
   *  shout on every boot. Branches pinned by apps/api/test/capabilities.test.ts
   *  ("usableEmailTransport" describe). */
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
  // #942: an id we cannot construct. Name it — the boot "selected but not usable" error keys on
  // `problem !== null`, so `null` here meant a typo'd SETU_EMAIL_ADAPTER produced no diagnostic
  // at all. The fallback is deliberately kept: refusing to boot would be a NEW fail-closed
  // behaviour on upgrade for a deployment that is currently limping along on the console.
  // Which source is named matters — the remediation is a different file in each case.
  if (!(KNOWN_TRANSPORTS as readonly string[]).includes(selected))
    return {
      selected,
      source,
      effective: 'console',
      problem:
        (source === 'env'
          ? `SETU_EMAIL_ADAPTER is set to "${selected}"`
          : `settings.json's email.provider is "${selected}"`) +
        `, which is not a transport Setu knows (expected ${orList(KNOWN_TRANSPORTS)})` +
        ' — emails fall back to the console adapter until it is corrected'
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
  /** #942: why a SET env fallback was ignored, for the boot log — null when nothing was
   *  rejected, including the unset/'' case, which is "not configured" rather than
   *  "misconfigured". Never echoes the offending address (an operator's from-address is not a
   *  credential, but the boot log is not the place to reprint it either); server.ts prints it
   *  once at boot. Pinned by apps/api/test/capabilities.test.ts ("resolveFromAddress" describe). */
  problem: string | null
}

/** The same rule the settings field enforces (packages/core/src/settings/schema.ts's
 *  `emailSchema.fromAddress`), applied to the env fallback that #885/#890 left unvalidated. */
const emailAddress = z.string().email()

export function resolveFromAddress(
  settingsFromAddress: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): FromAddressResolution {
  if (settingsFromAddress)
    return { effective: settingsFromAddress, source: 'settings', problem: null }
  const fromEnv = env.SETU_FORMS_NOTIFY_FROM
  if (fromEnv) {
    // #942: truthiness alone let a whitespace-only value through here, and from here it
    // satisfied `deliverable`, the reset gate's `Boolean(p.from)` and the submission gate —
    // an address no transport could ever send from. Degrade to "none configured" and say so.
    if (emailAddress.safeParse(fromEnv).success)
      return { effective: fromEnv, source: 'env', problem: null }
    return {
      effective: null,
      source: null,
      problem:
        'SETU_FORMS_NOTIFY_FROM is not a valid email address — it is ignored, so no ' +
        'from-address is configured. Fix it, or set one in Settings → Email.'
    }
  }
  return { effective: null, source: null, problem: null }
}

/** The email capability block for /api/capabilities. Built on the same two helpers above that
 *  server.ts's live sender and the /api/email/status thunk resolve from, so this can't claim a
 *  transport is live that the next send wouldn't actually use. server.ts calls it per request
 *  (re-reading settings.json) via createCapabilitiesApi's `resolveEmail` thunk.
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

/** capabilities is mostly boot-time-static (image adapter, storage, mode), but two blocks are NOT,
 *  so each gets a thunk that is called fresh on every request instead of baking a snapshot into
 *  the response returned once at boot:
 *
 *  - `auth.needsSetup` depends on the current user-table row count, which changes the moment
 *    first-run setup creates the owner account.
 *  - `email` (#890) depends on settings.json's `email.provider` + `email.fromAddress`, which an
 *    admin can change at runtime and which apply to the next send with NO restart. A snapshot
 *    here went stale on save, and this block is what the password-reset surfaces read
 *    (LoginScreen's "Forgot password?" card, UsersScreen's reset action) — so a stale
 *    `deliverable: false` told users reset was unconfigured while it genuinely worked. Pinned by
 *    apps/api/test/capabilities.test.ts ("email block: computed per-request").
 *
 *  Both thunks are REQUIRED, not optional: an omittable one is an invitation to re-introduce the
 *  snapshot. `base` still carries a boot value for each (buildCapabilities builds the whole
 *  shape); the thunk is what the response actually uses. The endpoint is unauthenticated, so a
 *  thunk must never widen the payload — the same test asserts `email` stays exactly
 *  transport + deliverable. */
export function createCapabilitiesApi(
  base: Omit<Capabilities, 'auth'>,
  resolveAuth: () => AuthCapabilities,
  resolveEmail: () => EmailCapabilities
) {
  const app = new Hono()
  app.get('/api/capabilities', (c) =>
    c.json({ ...base, auth: resolveAuth(), email: resolveEmail() })
  )
  app.onError(apiOnError({ scope: 'capabilities' })) // #291: e.g. a throwing thunk
  return app
}
