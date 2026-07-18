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

/** A social provider as this module emits it: credentials plus the invite-only sign-up lock.
 *
 *  #624 — Setu is invite-only. `createAuth` sets `disableSignUp: true` on emailAndPassword so
 *  `POST /api/auth/sign-up/email` has no legitimate caller, but the social providers carried NO
 *  sign-up restriction: setting SETU_GITHUB_CLIENT_ID/SECRET (or the Google pair) silently
 *  reopened open self-registration through the OAuth door. Any stranger could OAuth in and be
 *  created with the schema default role `author` (packages/db-sqlite/src/schema.ts), and could
 *  also permanently pre-empt first-run owner setup — the exact hole `disableSignUp` was added to
 *  close for passwords.
 *
 *  BOTH flags are set, and the distinction matters (verified in the installed better-auth 1.6.23,
 *  `dist/api/routes/callback.mjs:150` / `dist/api/routes/sign-in.mjs:115`):
 *      disableSignUp: provider.disableImplicitSignUp && !requestSignUp || provider.options?.disableSignUp
 *  `requestSignUp` is a caller-supplied field of the `/sign-in/social` body schema, so
 *  `disableImplicitSignUp` ALONE is defeated by an attacker sending `requestSignUp: true`.
 *  `disableSignUp` holds unconditionally and is what actually closes the hole; the implicit flag
 *  is kept alongside it as defence in depth and as the documented intent.
 *
 *  OAuth remains fully usable for its legitimate purpose: signing INTO, or linking to, an account
 *  an admin already invited. Only account CREATION is refused. */
interface SocialProviderConfig {
  clientId: string
  clientSecret: string
  disableSignUp: true
  disableImplicitSignUp: true
}

const SIGNUP_LOCKED = {
  disableSignUp: true,
  disableImplicitSignUp: true
} as const

/** better-auth's socialProviders option. Each provider is included only when BOTH its client id
 *  and secret are set — an incomplete pair is omitted (fail closed, not a broken provider) — and
 *  every emitted provider is sign-up-locked (see `SocialProviderConfig`, #624). */
export function authSocialProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env
):
  | {
      github?: SocialProviderConfig
      google?: SocialProviderConfig
    }
  | undefined {
  const out: {
    github?: SocialProviderConfig
    google?: SocialProviderConfig
  } = {}
  const githubId = env.SETU_GITHUB_CLIENT_ID
  const githubSecret = env.SETU_GITHUB_CLIENT_SECRET
  if (githubId && githubSecret)
    out.github = {
      clientId: githubId,
      clientSecret: githubSecret,
      ...SIGNUP_LOCKED
    }
  const googleId = env.SETU_GOOGLE_CLIENT_ID
  const googleSecret = env.SETU_GOOGLE_CLIENT_SECRET
  if (googleId && googleSecret)
    out.google = {
      clientId: googleId,
      clientSecret: googleSecret,
      ...SIGNUP_LOCKED
    }
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
