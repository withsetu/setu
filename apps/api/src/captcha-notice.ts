import { resolveSetuMode } from './config'

/** #918: the zero-config captcha default is a PASS-THROUGH, and until now it was silent.
 *
 *  `resolveCaptcha` in server.ts returns `createNoopCaptcha()` when `SETU_CAPTCHA_PROVIDER` is
 *  unset, and the two warnings beside it only fire when a provider IS selected — so the one
 *  configuration in which `POST /forms/submit` accepts every submission from anyone, forever,
 *  was also the one configuration that said nothing at boot. Dev wants exactly that pass-through
 *  and is deliberately kept quiet; every other topology gets a loud line.
 *
 *  "Outside dev" is `resolveSetuMode`, not `NODE_ENV`: NODE_ENV is unset on a plain
 *  `node server.js` self-hosted boot, so keying on it would have kept the silence exactly where
 *  it is dangerous. resolveSetuMode already fails closed to 'self-hosted' when SETU_MODE is unset.
 *
 *  Returns the line to log, or null when there is nothing to say. Pinned by
 *  apps/api/test/captcha-notice.test.ts. */
export function noCaptchaProviderNotice(env: {
  SETU_CAPTCHA_PROVIDER?: string | undefined
  SETU_MODE?: string | undefined
}): string | null {
  if ((env.SETU_CAPTCHA_PROVIDER ?? '') !== '') return null
  if (
    resolveSetuMode({
      ...(env.SETU_MODE ? { SETU_MODE: env.SETU_MODE } : {})
    }) === 'local'
  )
    return null
  return (
    'NO PROVIDER: SETU_CAPTCHA_PROVIDER is unset, so the public POST /forms/submit route ' +
    'accepts every submission with NO spam verification. Set ' +
    'SETU_CAPTCHA_PROVIDER=turnstile|recaptcha|recaptcha-v3 with its secret. The rate limit and ' +
    'the outbound-notification ceiling still bound the damage (#918), but they are a ceiling, ' +
    'not spam protection.'
  )
}
