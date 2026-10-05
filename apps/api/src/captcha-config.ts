import { createNoopCaptcha, type CaptchaPort } from '@setu/core'
import { createTurnstileCaptcha } from '@setu/captcha-turnstile'
import { createRecaptchaCaptcha } from '@setu/captcha-recaptcha'
import { resolveSetuMode } from './config'
import { noCaptchaProviderNotice } from './captcha-notice'
import {
  SUPPORTED_CAPTCHA_PROVIDERS,
  type CaptchaProviderId
} from './captcha-providers'

export { SUPPORTED_CAPTCHA_PROVIDERS, type CaptchaProviderId }

/** #1163: THE provider → env mapping. The forms resolver, better-auth's captcha option
 *  (auth/env.ts), the capabilities report and `/forms/captcha-status` all read captcha config
 *  through `resolveCaptchaConfig`, so a provider cannot be wired on one surface and missing on
 *  another. Pinned by apps/api/test/captcha-config.test.ts. */

const ENV_NAMES: Record<
  CaptchaProviderId,
  { secret: string; siteKey: string }
> = {
  turnstile: {
    secret: 'SETU_TURNSTILE_SECRET',
    siteKey: 'SETU_TURNSTILE_SITE_KEY'
  },
  recaptcha: {
    secret: 'SETU_RECAPTCHA_SECRET',
    siteKey: 'SETU_RECAPTCHA_SITE_KEY'
  }
}

/** A captcha configuration the api cannot run with. server.ts refuses to boot on it. */
export class CaptchaConfigError extends Error {
  override name = 'CaptchaConfigError'
}

export type CaptchaConfig =
  | { provider: null }
  | {
      provider: CaptchaProviderId
      /** '' when the provider's secret env is unset. */
      secret: string
      /** The PUBLIC site key ('' when unset). */
      siteKey: string
    }

type CaptchaEnv = Record<string, string | undefined>

/** The env var holding `provider`'s secret — for operator-facing messages. */
export function captchaSecretEnvName(provider: CaptchaProviderId): string {
  return ENV_NAMES[provider].secret
}

/** `SETU_RECAPTCHA_MIN_SCORE`: unset or blank → `undefined` (the adapter's 0.5 default applies);
 *  otherwise a plain decimal in [0, 1]. Anything else throws — a typo here must not silently become
 *  0 (accept everything) the way `Number('')` did. */
export function parseRecaptchaMinScore(
  raw: string | undefined
): number | undefined {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return undefined
  const n = /^\d+(\.\d+)?$|^\.\d+$/.test(trimmed) ? Number(trimmed) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 1)
    throw new CaptchaConfigError(
      `SETU_RECAPTCHA_MIN_SCORE must be a number from 0 to 1 (got "${trimmed}"). ` +
        'Unset it to use the default of 0.5.'
    )
  return n
}

/** Read and validate captcha config. Throws `CaptchaConfigError` for an unsupported provider
 *  (including `recaptcha-v3`, which is not wired end to end yet — #1175) or an invalid
 *  `SETU_RECAPTCHA_MIN_SCORE`. A provider with an unset secret is NOT an error here: what that
 *  means depends on the topology, and `createFormsCaptcha` decides it. */
export function resolveCaptchaConfig(env: CaptchaEnv): CaptchaConfig {
  parseRecaptchaMinScore(env.SETU_RECAPTCHA_MIN_SCORE)
  const raw = (env.SETU_CAPTCHA_PROVIDER ?? '').trim()
  if (raw === '') return { provider: null }
  const supported = SUPPORTED_CAPTCHA_PROVIDERS.join(' | ')
  if (raw === 'recaptcha-v3')
    throw new CaptchaConfigError(
      'SETU_CAPTCHA_PROVIDER=recaptcha-v3 is not supported yet: the contact form and the admin ' +
        'sign-in screen render only checkbox-style widgets, so a v3 site cannot produce a token. ' +
        `Use one of: ${supported} (reCAPTCHA v2 is "recaptcha").`
    )
  if (!(SUPPORTED_CAPTCHA_PROVIDERS as readonly string[]).includes(raw))
    throw new CaptchaConfigError(
      `SETU_CAPTCHA_PROVIDER="${raw}" is not a supported provider. Use one of: ${supported}, ` +
        'or unset it.'
    )
  const provider = raw as CaptchaProviderId
  return {
    provider,
    secret: env[ENV_NAMES[provider].secret] ?? '',
    siteKey: env[ENV_NAMES[provider].siteKey] ?? ''
  }
}

const rejectAll: CaptchaPort = {
  async verify() {
    return false
  }
}

/** The CaptchaPort `POST /forms/submit` verifies with.
 *
 *  - no provider → pass-through, with the #918 notice outside local mode (captcha-notice.ts);
 *  - provider selected, secret unset → REJECT every submission, unless `resolveSetuMode(env)` is
 *    'local'. Keyed on the mode rather than NODE_ENV for the same reason as the #918 branch: the
 *    api's start script sets no NODE_ENV, so a NODE_ENV check passed everything through on a plain
 *    self-hosted boot;
 *  - otherwise → the provider's adapter (each bounded by the shared siteverify deadline).
 *
 *  Each branch is pinned by apps/api/test/captcha-config.test.ts. */
export function createFormsCaptcha(
  config: CaptchaConfig,
  env: CaptchaEnv,
  log: { error: (msg: string) => void; warn: (msg: string) => void },
  fetchImpl?: typeof fetch
): CaptchaPort {
  if (config.provider === null) {
    const notice = noCaptchaProviderNotice(env)
    if (notice !== null) log.error(`[captcha] ${notice}`)
    return createNoopCaptcha()
  }
  if (!config.secret) {
    const secretEnv = captchaSecretEnvName(config.provider)
    if (resolveSetuMode(env) === 'local') {
      log.warn(
        `[captcha] provider "${config.provider}" is selected but ${secretEnv} is unset — local ` +
          'mode, so form submissions pass through unverified and sign-in/password reset run ' +
          'without captcha. Any other SETU_MODE rejects every submission in this state.'
      )
      return createNoopCaptcha()
    }
    log.error(
      `[captcha] provider "${config.provider}" is selected but ${secretEnv} is unset — ` +
        'rejecting every form submission until it is set. Sign-in and password reset run ' +
        `without captcha in this state. Set ${secretEnv}, or unset SETU_CAPTCHA_PROVIDER.`
    )
    return rejectAll
  }
  const adapterOpts = {
    secret: config.secret,
    ...(fetchImpl ? { fetchImpl } : {})
  }
  return config.provider === 'recaptcha'
    ? createRecaptchaCaptcha(adapterOpts)
    : createTurnstileCaptcha(adapterOpts)
}
