import type { CaptchaPort } from '@setu/core'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare Turnstile CaptchaPort. Fail-closed. `fetchImpl` injectable for tests. */
export function createTurnstileCaptcha(opts: { secret: string; fetchImpl?: typeof fetch }): CaptchaPort {
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
