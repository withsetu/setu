/** Shared env-parsing helpers for Better Auth wiring. Extracted so both server.ts (boot-time
 *  auth construction) and capabilities.ts (per-request truthful reporting of what's configured)
 *  read the exact same env vars the exact same way — duplicating this logic would risk the two
 *  silently drifting (e.g. capabilities claiming a provider is enabled that createAuth actually
 *  omitted, or vice versa). */

/** better-auth's captcha plugin option, derived from the same env vars forms captcha reads.
 *  Omitted entirely when no provider is configured or its secret is unset (fail closed — no
 *  captcha plugin means better-auth doesn't gate on a check we can't perform). */
export function authCaptchaFromEnv(
  env: NodeJS.ProcessEnv = process.env
):
  | { provider: 'cloudflare-turnstile' | 'google-recaptcha'; secretKey: string }
  | undefined {
  const provider = env.SETU_CAPTCHA_PROVIDER ?? ''
  if (provider !== 'turnstile' && provider !== 'recaptcha') return undefined
  const secretKey =
    provider === 'recaptcha'
      ? (env.SETU_RECAPTCHA_SECRET ?? '')
      : (env.SETU_TURNSTILE_SECRET ?? '')
  if (!secretKey) return undefined
  return {
    provider:
      provider === 'turnstile' ? 'cloudflare-turnstile' : 'google-recaptcha',
    secretKey
  }
}

/** better-auth's socialProviders option. Each provider is included only when BOTH its client id
 *  and secret are set — an incomplete pair is omitted (fail closed, not a broken provider). */
export function authSocialProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env
):
  | {
      github?: { clientId: string; clientSecret: string }
      google?: { clientId: string; clientSecret: string }
    }
  | undefined {
  const out: {
    github?: { clientId: string; clientSecret: string }
    google?: { clientId: string; clientSecret: string }
  } = {}
  const githubId = env.SETU_GITHUB_CLIENT_ID
  const githubSecret = env.SETU_GITHUB_CLIENT_SECRET
  if (githubId && githubSecret)
    out.github = { clientId: githubId, clientSecret: githubSecret }
  const googleId = env.SETU_GOOGLE_CLIENT_ID
  const googleSecret = env.SETU_GOOGLE_CLIENT_SECRET
  if (googleId && googleSecret)
    out.google = { clientId: googleId, clientSecret: googleSecret }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Which social providers (as capabilities reports them) have a complete env pair. Reuses
 *  authSocialProvidersFromEnv rather than re-parsing env vars a third way. */
export function socialProvidersEnabled(
  env: NodeJS.ProcessEnv = process.env
): ('github' | 'google')[] {
  const providers = authSocialProvidersFromEnv(env)
  const out: ('github' | 'google')[] = []
  if (providers?.github) out.push('github')
  if (providers?.google) out.push('google')
  return out
}

/** Public captcha info for capabilities: provider + PUBLIC site key, present only when the
 *  provider is fully configured server-side (matches authCaptchaFromEnv's fail-closed gate) AND
 *  its public site-key env is set. The SECRET is never read here — only the site-key envs, which
 *  are safe to expose to any authenticated capabilities caller.
 *
 *  Site-key env names (SETU_TURNSTILE_SITE_KEY / SETU_RECAPTCHA_SITE_KEY): no such convention
 *  existed before this task — the forms/contact block reads its site key from a build-time Astro
 *  public env (PUBLIC_CAPTCHA_SITE_KEY, see blocks/contact/contact.astro), which is a different
 *  consumer (static site build) than this runtime admin-facing capabilities endpoint. These two
 *  new SETU_*_SITE_KEY server env vars are introduced here to mirror the existing
 *  SETU_TURNSTILE_SECRET/SETU_RECAPTCHA_SECRET naming convention.
 */
export function captchaCapabilityFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null {
  const serverConfigured = authCaptchaFromEnv(env)
  if (!serverConfigured) return null
  const provider =
    serverConfigured.provider === 'google-recaptcha' ? 'recaptcha' : 'turnstile'
  const siteKey =
    provider === 'recaptcha'
      ? (env.SETU_RECAPTCHA_SITE_KEY ?? '')
      : (env.SETU_TURNSTILE_SITE_KEY ?? '')
  if (!siteKey) return null
  return { provider, siteKey }
}
