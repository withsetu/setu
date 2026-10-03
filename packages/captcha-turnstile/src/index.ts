import { postSiteverify, type CaptchaPort } from '@setu/core'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare Turnstile CaptchaPort. Fail-closed, including when siteverify does not answer within
 *  `SITEVERIFY_TIMEOUT_MS` (@setu/core `postSiteverify`). `fetchImpl` injectable for tests. */
export function createTurnstileCaptcha(opts: {
  secret: string
  fetchImpl?: typeof fetch
}): CaptchaPort {
  const f = opts.fetchImpl ?? fetch
  return {
    async verify(token, remoteip) {
      const body = new URLSearchParams({
        secret: opts.secret,
        response: token
      })
      if (remoteip) body.set('remoteip', remoteip)
      const data = (await postSiteverify({
        fetchImpl: f,
        url: SITEVERIFY,
        body
      })) as { success?: boolean } | null
      return data?.success === true
    }
  }
}
