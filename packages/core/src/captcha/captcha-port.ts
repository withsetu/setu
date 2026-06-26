/** Provider-agnostic spam-protection verifier. Implementations live in adapter
 *  packages (@setu/captcha-turnstile, @setu/captcha-recaptcha). Always
 *  fail-closed: any error/non-success → false. */
export interface CaptchaPort {
  verify(token: string, remoteip?: string): Promise<boolean>
}

/** Dev / no-provider pass-through: accepts everything. Named explicitly so it is
 *  never mistaken for a real verifier. */
export function createNoopCaptcha(): CaptchaPort {
  return { async verify() { return true } }
}
