/** The `SETU_CAPTCHA_PROVIDER` values Setu supports end to end — server verification, the
 *  sign-in/reset gate, capabilities, the admin login widget and the contact block. The single list
 *  both the boot validator (captcha-config.ts) and the operator notice (captcha-notice.ts) read,
 *  so the notice cannot advertise a value the validator refuses (#1163). Pinned by
 *  apps/api/test/captcha-config.test.ts ("advertises only the providers it accepts"). */
export const SUPPORTED_CAPTCHA_PROVIDERS = ['turnstile', 'recaptcha'] as const
export type CaptchaProviderId = (typeof SUPPORTED_CAPTCHA_PROVIDERS)[number]
