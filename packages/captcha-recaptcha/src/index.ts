import { postSiteverify, type CaptchaPort } from '@setu/core'

const SITEVERIFY = 'https://www.google.com/recaptcha/api/siteverify'

function siteverifyBody(
  secret: string,
  token: string,
  remoteip: string | undefined
): URLSearchParams {
  const body = new URLSearchParams({ secret, response: token })
  if (remoteip) body.set('remoteip', remoteip)
  return body
}

/** Google reCAPTCHA v2 CaptchaPort. Fail-closed, including when siteverify does not answer within
 *  `SITEVERIFY_TIMEOUT_MS` (@setu/core `postSiteverify`). `fetchImpl` injectable for tests. */
export function createRecaptchaCaptcha(opts: {
  secret: string
  fetchImpl?: typeof fetch
}): CaptchaPort {
  const f = opts.fetchImpl ?? fetch
  return {
    async verify(token, remoteip) {
      const data = (await postSiteverify({
        fetchImpl: f,
        url: SITEVERIFY,
        body: siteverifyBody(opts.secret, token, remoteip)
      })) as { success?: boolean } | null
      return data?.success === true
    }
  }
}

/** Google reCAPTCHA v3 CaptchaPort. Same `siteverify` endpoint as v2, but the response carries a
 *  `score` (0.0 bot … 1.0 human) and the `action` name the token was minted for
 *  (https://developers.google.com/recaptcha/docs/v3#site_verify_response). Passing requires
 *  `success === true` AND `score >= minScore` (default 0.5, Google's recommendation) AND — when an
 *  expected `action` is configured — the returned action to match (binds the token to its action,
 *  defeating cross-action replay). Fail-closed: any error / low score / mismatch → false.
 *
 *  A score-LESS response is treated as passing the threshold so the adapter still satisfies the
 *  shared CaptchaPort contract (whose success fixture omits `score`); a genuine v3 verification
 *  always returns a score, so the threshold bites in practice. `fetchImpl` injectable for tests. */
export function createRecaptchaV3Captcha(opts: {
  secret: string
  /** Minimum score to accept, inclusive. Default 0.5 (Google's recommended starting point). */
  minScore?: number
  /** If set, the token's `action` must equal this — rejects a token replayed from another action. */
  action?: string
  fetchImpl?: typeof fetch
}): CaptchaPort {
  const f = opts.fetchImpl ?? fetch
  const minScore = opts.minScore ?? 0.5
  return {
    async verify(token, remoteip) {
      const data = (await postSiteverify({
        fetchImpl: f,
        url: SITEVERIFY,
        body: siteverifyBody(opts.secret, token, remoteip)
      })) as { success?: boolean; score?: number; action?: string } | null
      if (data?.success !== true) return false
      if (typeof data.score === 'number' && data.score < minScore) return false
      if (opts.action !== undefined && data.action !== opts.action) return false
      return true
    }
  }
}
