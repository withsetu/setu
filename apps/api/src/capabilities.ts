import { Hono } from 'hono'

export interface AuthCapabilities {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

/** #364: which email transport this boot selected, and whether it's the kind of adapter that
 *  actually delivers mail anywhere. `transport` mirrors `SETU_EMAIL_ADAPTER` verbatim (whatever
 *  value server.ts read to pick the real adapter object — 'console' | 'resend' today); `deliverable`
 *  is `false` for dev/no-op transports (console) and `true` only for a real one (resend), so the
 *  admin UI can tell "reset emails are configured" from "they'll only ever show up in server logs"
 *  without hardcoding the transport name itself. */
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

/** Reads the SAME env var + selection logic server.ts uses to pick the real email adapter object
 *  (`SETU_EMAIL_ADAPTER`, `=== 'resend' ? resend : console` — anything unrecognized falls back to
 *  console there too), so this can't silently claim a transport is live that server.ts didn't
 *  actually wire up (mirrors the shared-env-parsing rationale in auth/env.ts). Add a branch here
 *  the same day a new real adapter is wired into server.ts's ternary — never infer "any non-console
 *  string is real" or the two will drift the moment an unrecognized value falls back silently. */
export function emailCapabilityFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EmailCapabilities {
  const transport = env.SETU_EMAIL_ADAPTER ?? 'console'
  return { transport, deliverable: transport === 'resend' }
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
  return app
}
