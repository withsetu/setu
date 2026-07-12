import { Hono } from 'hono'
import { apiOnError } from './errors'

export interface AuthCapabilities {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

/** #364: which email transport this boot selected, and whether it's the kind of adapter that
 *  actually delivers mail anywhere. `transport` mirrors `SETU_EMAIL_ADAPTER` verbatim (whatever
 *  value server.ts read to pick the real adapter object — 'console' | 'resend' today); `deliverable`
 *  is `false` for dev/no-op transports (console) and for a real transport with no configured
 *  from-address (`SETU_FORMS_NOTIFY_FROM`) — server.ts only wires the real send path when both are
 *  true — and `true` only when both hold, so the admin UI can tell "reset emails will actually go
 *  out" from "they'll only ever show up in server logs, or never send at all" without hardcoding
 *  the transport name itself. */
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
  }
  auth: AuthCapabilities
  email: EmailCapabilities
}

export function buildCapabilities(opts: {
  image?: unknown
  writableMediaStore: boolean
  backgroundJobs: boolean
  mode?: string
  auth: AuthCapabilities
  email: EmailCapabilities
}): Capabilities {
  return {
    ...(opts.mode ? { mode: opts.mode } : {}),
    capabilities: {
      imageProcessing: !!opts.image,
      writableMediaStore: opts.writableMediaStore,
      backgroundJobs: opts.backgroundJobs
    },
    auth: opts.auth,
    email: opts.email
  }
}

/** Reads the SAME env vars + selection logic server.ts uses to pick the real email adapter object
 *  (`SETU_EMAIL_ADAPTER`, `=== 'resend' ? resend : console` — anything unrecognized falls back to
 *  console there too), so this can't silently claim a transport is live that server.ts didn't
 *  actually wire up (mirrors the shared-env-parsing rationale in auth/env.ts). Add a branch here
 *  the same day a new real adapter is wired into server.ts's ternary — never infer "any non-console
 *  string is real" or the two will drift the moment an unrecognized value falls back silently.
 *
 *  `deliverable` ALSO requires `SETU_FORMS_NOTIFY_FROM` (#364 fix): server.ts only passes
 *  `createAuth`'s `email` option (the thing that actually wires `POST /request-password-reset` to
 *  send) when `notifyFrom` is truthy (see the `email: notifyFrom ? {...} : undefined` ternary
 *  there) — a resend transport with no from-address still constructs a real adapter object at
 *  line ~126, but `auth.email` stays `undefined`, so reset stays `RESET_PASSWORD_DISABLED` even
 *  though this used to report `deliverable: true`. Reading `SETU_FORMS_NOTIFY_FROM` here (the same
 *  env var server.ts reads into `notifyFrom`) keeps this the single source of truth for "would a
 *  reset email actually go out" without server.ts having to re-derive its own boolean and pass it
 *  in separately — both call sites key off the identical env var name, so they can't drift. */
export function emailCapabilityFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EmailCapabilities {
  const transport = env.SETU_EMAIL_ADAPTER ?? 'console'
  const hasFromAddress = Boolean(env.SETU_FORMS_NOTIFY_FROM)
  return { transport, deliverable: transport === 'resend' && hasFromAddress }
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
