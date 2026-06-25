import type { CaptchaPort } from '@setu/core'

const SITEVERIFY = 'https://www.google.com/recaptcha/api/siteverify'

/** Google reCAPTCHA v2 CaptchaPort. Fail-closed. `fetchImpl` injectable for tests. */
export function createRecaptchaCaptcha(opts: { secret: string; fetchImpl?: typeof fetch }): CaptchaPort {
  const f = opts.fetchImpl ?? fetch
  return {
    async verify(token, remoteip) {
      try {
        const body = new URLSearchParams({ secret: opts.secret, response: token })
        if (remoteip) body.set('remoteip', remoteip)
        const res = await f(SITEVERIFY, { method: 'POST', body })
        if (!res.ok) return false
        const data = (await res.json()) as { success?: boolean }
        return data.success === true
      } catch {
        return false
      }
    },
  }
}
