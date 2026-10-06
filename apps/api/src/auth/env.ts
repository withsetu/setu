import { resolveCaptchaConfig, type CaptchaProviderId } from '../captcha-config'

/** Shared env-parsing helpers for Better Auth wiring. Extracted so both server.ts (boot-time
 *  auth construction) and capabilities.ts (per-request truthful reporting of what's configured)
 *  read the exact same env vars the exact same way — duplicating this logic would risk the two
 *  silently drifting (e.g. capabilities claiming a provider is enabled that createAuth actually
 *  omitted, or vice versa). */

/** better-auth's captcha plugin option, read through the shared provider→secret mapping
 *  (`resolveCaptchaConfig`, ../captcha-config.ts — the same one the forms resolver uses, #1163).
 *  Omitted when no provider is configured or its secret is unset: better-auth then runs sign-in
 *  and password reset WITHOUT a captcha (the password and the rate limit still gate them). That
 *  is deliberately not "reject all" like the forms path — refusing every sign-in would lock the
 *  operator out — and the forms resolver's boot line says so out loud. Behaviour pinned by
 *  apps/api/test/captcha-config.test.ts ("auth + capabilities read the same mapping"). */
export function authCaptchaFromEnv(
  env: NodeJS.ProcessEnv = process.env
):
  | { provider: 'cloudflare-turnstile' | 'google-recaptcha'; secretKey: string }
  | undefined {
  const config = resolveCaptchaConfig(env)
  if (config.provider === null || !config.secret) return undefined
  return {
    provider:
      config.provider === 'turnstile'
        ? 'cloudflare-turnstile'
        : 'google-recaptcha',
    secretKey: config.secret
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
 *  BOTH flags are set, but — #645 — they do NOT both hold everywhere, and the original version of
 *  this comment was wrong to claim `disableSignUp` "holds unconditionally". The two better-auth
 *  routes that consume these flags read DIFFERENT PROPERTIES (verified in the installed
 *  better-auth 1.6.23, read not assumed; unchanged through 1.7.6):
 *    - `dist/context/create-context.mjs` (1.7.7: lines 103-104) hoists ONLY
 *      `disableImplicitSignUp` onto the constructed provider; `disableSignUp` survives solely
 *      under `provider.options`.
 *    - `dist/api/routes/callback.mjs` (1.7.7: line 181)
 *        provider.disableImplicitSignUp && !requestSignUp || provider.options?.disableSignUp
 *      → reads our value. CLOSED.
 *    - `dist/api/routes/sign-in.mjs`, ID-token branch, through 1.7.6
 *        provider.disableImplicitSignUp && !c.body.requestSignUp || provider.disableSignUp
 *      → read the TOP-LEVEL property, which is `undefined`. `requestSignUp` is caller-supplied
 *      (1.7.7 `sign-in.mjs:102`), so `requestSignUp: true` made this falsy and PERMITTED sign-up.
 *      better-auth 1.7.7 (better-auth/better-auth#11491) added
 *      `|| provider.options?.disableSignUp` (`sign-in.mjs:197`), so both routes now read our
 *      value.
 *
 *  These flags are therefore defence in depth, NOT the wall. The wall is
 *  `packages/auth/src/signup-origin-guard.ts`: a `user.create.before` databaseHook that allowlists
 *  the request paths Setu legitimately creates accounts from (`/setup`, `/admin/create-user`, and
 *  host-side calls with no request context) and fails closed everywhere else — independent of any
 *  better-auth flag plumbing. Read that file before changing anything here.
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
 *  provider is fully configured server-side (the same condition authCaptchaFromEnv emits on) AND
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
): { provider: CaptchaProviderId; siteKey: string } | null {
  const config = resolveCaptchaConfig(env)
  if (config.provider === null || !config.secret || !config.siteKey) return null
  return { provider: config.provider, siteKey: config.siteKey }
}
