import { Hono } from 'hono'

export interface AuthCapabilities {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

export interface Capabilities {
  mode?: string
  capabilities: { imageProcessing: boolean; writableMediaStore: boolean; backgroundJobs: boolean }
  auth: AuthCapabilities
}

export function buildCapabilities(opts: {
  image?: unknown
  writableMediaStore: boolean
  backgroundJobs: boolean
  mode?: string
  auth: AuthCapabilities
}): Capabilities {
  return {
    ...(opts.mode ? { mode: opts.mode } : {}),
    capabilities: {
      imageProcessing: !!opts.image,
      writableMediaStore: opts.writableMediaStore,
      backgroundJobs: opts.backgroundJobs,
    },
    auth: opts.auth,
  }
}

/** capabilities is mostly boot-time-static (image adapter, storage, mode), but the `auth` block's
 *  `needsSetup` flag is NOT — it depends on the current user-table row count, which changes the
 *  moment first-run setup creates the owner account. So `createCapabilitiesApi` takes the static
 *  shape plus a thunk for the auth block, and calls the thunk fresh on every request rather than
 *  baking a snapshot into the response returned once at boot. */
export function createCapabilitiesApi(
  base: Omit<Capabilities, 'auth'>,
  resolveAuth: () => AuthCapabilities,
) {
  const app = new Hono()
  app.get('/api/capabilities', (c) => c.json({ ...base, auth: resolveAuth() }))
  return app
}
